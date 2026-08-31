// =============================================================================
// FOUNDRY — Predictive Intelligence
// Churn prediction, revenue forecasting, market timing signals.
// =============================================================================

import { query, getLatestMetrics, getActiveStressors } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from './revenue.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { log } from '../../lib/logger.js';

// ─── Revenue Forecast ──────────────────────────────────────────────────────

export interface RevenueForecast {
  current_mrr_cents: number;
  projected_mrr_30d: number;
  projected_mrr_60d: number;
  projected_mrr_90d: number;
  growth_rate_monthly: number;
  churn_impact_monthly: number;
  net_growth_rate: number;
  months_to_target: number | null;
  target_mrr_cents: number;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
}

/**
 * Generate a revenue forecast based on historical metric snapshots.
 * Uses linear regression on MRR data points to project forward.
 */
export async function forecastRevenue(productId: string): Promise<RevenueForecast | null> {
  const snapshots = await query(
    `SELECT snapshot_date, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents
     FROM metric_snapshots WHERE product_id = ? AND new_mrr_cents IS NOT NULL
     ORDER BY snapshot_date DESC LIMIT 12`,
    [productId]
  );

  if (snapshots.rows.length < 3) return null;

  const rows = snapshots.rows as Array<Record<string, number>>;

  // Calculate monthly net MRR changes
  const netChanges = rows.map((r) =>
    (r.new_mrr_cents ?? 0) + (r.expansion_mrr_cents ?? 0) - (r.contraction_mrr_cents ?? 0) - (r.churned_mrr_cents ?? 0)
  );

  // Current MRR is the latest snapshot's total
  const currentMrr = netChanges[0] ?? 0;
  const avgMonthlyGrowth = netChanges.reduce((sum, v) => sum + v, 0) / netChanges.length;
  const avgChurn = rows.reduce((sum, r) => sum + (r.churned_mrr_cents ?? 0), 0) / rows.length;
  const avgNew = rows.reduce((sum, r) => sum + (r.new_mrr_cents ?? 0), 0) / rows.length;

  const growthRate = currentMrr > 0 ? avgMonthlyGrowth / currentMrr : 0;
  const churnRate = currentMrr > 0 ? avgChurn / currentMrr : 0;
  const netGrowthRate = growthRate - churnRate;

  // Project forward
  const projected30 = Math.round(currentMrr * (1 + netGrowthRate));
  const projected60 = Math.round(currentMrr * Math.pow(1 + netGrowthRate, 2));
  const projected90 = Math.round(currentMrr * Math.pow(1 + netGrowthRate, 3));

  // Months to $10K MRR target
  const targetMrr = 1000000; // $10K in cents
  let monthsToTarget: number | null = null;
  if (netGrowthRate > 0 && currentMrr < targetMrr) {
    monthsToTarget = Math.ceil(Math.log(targetMrr / currentMrr) / Math.log(1 + netGrowthRate));
    if (monthsToTarget > 120) monthsToTarget = null; // > 10 years = unrealistic
  }

  const confidence: RevenueForecast['confidence'] = snapshots.rows.length >= 8 ? 'high' : snapshots.rows.length >= 5 ? 'medium' : 'low';

  const assumptions = [
    `Based on ${snapshots.rows.length} data points`,
    `Average monthly growth: $${(avgMonthlyGrowth / 100).toFixed(0)}`,
    `Average monthly churn: $${(avgChurn / 100).toFixed(0)}`,
  ];
  if (confidence === 'low') assumptions.push('Low confidence — more data needed for reliable projections');

  return {
    current_mrr_cents: currentMrr,
    projected_mrr_30d: projected30,
    projected_mrr_60d: projected60,
    projected_mrr_90d: projected90,
    growth_rate_monthly: growthRate,
    churn_impact_monthly: churnRate,
    net_growth_rate: netGrowthRate,
    months_to_target: monthsToTarget,
    target_mrr_cents: targetMrr,
    confidence,
    assumptions,
  };
}

// ─── Churn Risk Assessment ──────────────────────────────────────────────────

export interface ChurnRiskAssessment {
  overall_risk: 'low' | 'medium' | 'high' | 'critical';
  risk_score: number; // 0-100
  signals: Array<{ signal: string; weight: number; direction: 'negative' | 'neutral' | 'positive' }>;
  recommended_actions: string[];
}

/**
 * Assess overall churn risk for a product based on multiple signals.
 */
export async function assessChurnRisk(productId: string): Promise<ChurnRiskAssessment> {
  const [metrics, mrr, stressors] = await Promise.all([
    getLatestMetrics(productId),
    getMRRDecomposition(productId),
    getActiveStressors(productId),
  ]);

  const metricsRow = metrics.rows[0] as Record<string, number> | undefined;
  const mrrHealth = mrr ? computeHealthRatio(mrr) : null;
  const signals: ChurnRiskAssessment['signals'] = [];
  let riskScore = 0;

  // Signal 1: MRR Health Ratio. A null ratio used to arrive here as 0 and take
  // the last branch — "Healthy churn-to-revenue ratio" asserted about a company
  // with no new MRR to divide by.
  if (mrrHealth?.value != null) {
    if (mrrHealth.value >= 1.0) {
      signals.push({ signal: 'Churn exceeds new revenue', weight: 30, direction: 'negative' });
      riskScore += 30;
    } else if (mrrHealth.value >= 0.7) {
      signals.push({ signal: 'Churn approaching new revenue', weight: 15, direction: 'negative' });
      riskScore += 15;
    } else {
      signals.push({ signal: 'Healthy churn-to-revenue ratio', weight: 0, direction: 'positive' });
    }
  }

  // Signal 2: Retention trend
  if (metricsRow?.day_30_retention != null) {
    const retention = metricsRow.day_30_retention;
    if (retention < 0.3) {
      signals.push({ signal: `Day-30 retention critically low (${(retention * 100).toFixed(0)}%)`, weight: 25, direction: 'negative' });
      riskScore += 25;
    } else if (retention < 0.5) {
      signals.push({ signal: `Day-30 retention below average (${(retention * 100).toFixed(0)}%)`, weight: 10, direction: 'negative' });
      riskScore += 10;
    } else {
      signals.push({ signal: `Day-30 retention healthy (${(retention * 100).toFixed(0)}%)`, weight: 0, direction: 'positive' });
    }
  }

  // Signal 3: Active stressor count
  const criticalStressors = stressors.rows.filter((s) => (s as Record<string, string>).severity === 'critical').length;
  if (criticalStressors >= 2) {
    signals.push({ signal: `${criticalStressors} critical stressors active`, weight: 20, direction: 'negative' });
    riskScore += 20;
  } else if (stressors.rows.length >= 3) {
    signals.push({ signal: `${stressors.rows.length} stressors active`, weight: 10, direction: 'negative' });
    riskScore += 10;
  }

  // Signal 4: NPS
  if (metricsRow?.nps_score != null) {
    if (metricsRow.nps_score < 0) {
      signals.push({ signal: `Negative NPS (${metricsRow.nps_score})`, weight: 15, direction: 'negative' });
      riskScore += 15;
    } else if (metricsRow.nps_score < 30) {
      signals.push({ signal: `Low NPS (${metricsRow.nps_score})`, weight: 5, direction: 'negative' });
      riskScore += 5;
    }
  }

  // Signal 5: Activation rate
  if (metricsRow?.activation_rate != null && metricsRow.activation_rate < 0.4) {
    signals.push({ signal: `Low activation rate (${(metricsRow.activation_rate * 100).toFixed(0)}%)`, weight: 10, direction: 'negative' });
    riskScore += 10;
  }

  riskScore = Math.min(100, riskScore);
  const overallRisk: ChurnRiskAssessment['overall_risk'] =
    riskScore >= 60 ? 'critical' : riskScore >= 40 ? 'high' : riskScore >= 20 ? 'medium' : 'low';

  // Recommended actions
  const actions: string[] = [];
  if (mrrHealth?.value != null && mrrHealth.value >= 0.7) actions.push('Investigate top churn reasons — conduct exit surveys');
  if (metricsRow?.day_30_retention != null && metricsRow.day_30_retention < 0.5) actions.push('Review onboarding flow — activation-to-retention gap detected');
  if (metricsRow?.activation_rate != null && metricsRow.activation_rate < 0.4) actions.push('Simplify time-to-value — reduce steps to first success');
  if (actions.length === 0) actions.push('No immediate action required — continue monitoring');

  return { overall_risk: overallRisk, risk_score: riskScore, signals, recommended_actions: actions };
}

// ─── Proactive Insights ─────────────────────────────────────────────────────

export interface ProactiveInsight {
  id: string;
  type: 'trend' | 'anomaly' | 'opportunity' | 'warning';
  title: string;
  body: string;
  urgency: 'low' | 'medium' | 'high';
  action?: { label: string; url: string };
  generated_at: string;
}

/**
 * Generate proactive insights by analyzing metric trends and patterns.
 */
export async function generateProactiveInsights(productId: string): Promise<ProactiveInsight[]> {
  const insights: ProactiveInsight[] = [];
  const now = new Date().toISOString();

  // "LAST PERIOD" WAS WHATEVER THE PREVIOUS ROW HAPPENED TO BE. These insights
  // compare the two most recent snapshots and every one of them says "from last
  // period" or "recently". `metric_snapshots` is keyed by DATE and most
  // companies report daily, so for them this is yesterday against the day
  // before — and `signups_7d` and `support_volume_7d` are SEVEN-DAY ROLLING
  // WINDOWS, so two adjacent days share six of their seven days. A 50% jump
  // between overlapping windows is a different event from a 50% jump between
  // periods, and the founder was told the second.
  //
  // The comparison is unchanged; what changes is that the interval it actually
  // covers travels with the sentence, so the reader can weigh it.
  const snapshots = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 2',
    [productId]
  );

  if (snapshots.rows.length < 2) return insights;

  const current = snapshots.rows[0] as Record<string, number>;
  const prior = snapshots.rows[1] as Record<string, number>;
  const gapDays = Math.round(
    (Date.parse(`${String((current as unknown as Record<string, string>).snapshot_date)}T00:00:00Z`)
      - Date.parse(`${String((prior as unknown as Record<string, string>).snapshot_date)}T00:00:00Z`))
    / 86_400_000);
  const over = Number.isFinite(gapDays) && gapDays > 0
    ? (gapDays === 1 ? 'over one day' : `over ${gapDays} days`)
    : 'between the last two reports';

  // Activation + Signup divergence
  if (current.signups_7d && prior.signups_7d && current.activation_rate && prior.activation_rate) {
    const signupGrowth = (current.signups_7d - prior.signups_7d) / Math.max(prior.signups_7d, 1);
    const activationDelta = current.activation_rate - prior.activation_rate;

    if (signupGrowth > 0.15 && activationDelta < -0.05) {
      insights.push({
        id: `insight-signup-activation-${productId}`,
        type: 'anomaly',
        title: 'Signups up but activation down',
        body: `Signups grew ${(signupGrowth * 100).toFixed(0)}% ${over} while activation dropped ${(Math.abs(activationDelta) * 100).toFixed(1)}pp. Both are seven-day rolling figures, so consecutive reports overlap. This usually means lower-intent traffic. Check which acquisition channel grew and whether your onboarding handles these users.`,
        urgency: 'high',
        action: { label: 'View Cohorts', url: `/products/${productId}/cohorts` },
        generated_at: now,
      });
    }
  }

  // Churn acceleration
  if (current.churned_mrr_cents && prior.churned_mrr_cents) {
    const churnGrowth = prior.churned_mrr_cents > 0
      ? (current.churned_mrr_cents - prior.churned_mrr_cents) / prior.churned_mrr_cents
      : 0;
    if (churnGrowth > 0.5) {
      insights.push({
        id: `insight-churn-spike-${productId}`,
        type: 'warning',
        title: 'Churn accelerating',
        body: `Churned MRR increased ${(churnGrowth * 100).toFixed(0)}% ${over} ($${(prior.churned_mrr_cents / 100).toFixed(0)} → $${(current.churned_mrr_cents / 100).toFixed(0)}). Identify the cohort driving this before it compounds.`,
        urgency: 'high',
        action: { label: 'View Revenue', url: `/products/${productId}/revenue` },
        generated_at: now,
      });
    }
  }

  // Retention improvement
  if (current.day_30_retention && prior.day_30_retention) {
    const retDelta = current.day_30_retention - prior.day_30_retention;
    if (retDelta > 0.05) {
      insights.push({
        id: `insight-retention-up-${productId}`,
        type: 'opportunity',
        title: 'Retention improving',
        body: `Day-30 retention increased ${(retDelta * 100).toFixed(1)}pp ${over} (${(prior.day_30_retention * 100).toFixed(0)}% → ${(current.day_30_retention * 100).toFixed(0)}%). Whatever you changed is working. Consider documenting it in the Failure Log (as a success).`,
        urgency: 'low',
        generated_at: now,
      });
    }
  }

  // Support volume spike
  if (current.support_volume_7d && prior.support_volume_7d) {
    const supportGrowth = prior.support_volume_7d > 0
      ? (current.support_volume_7d - prior.support_volume_7d) / prior.support_volume_7d
      : 0;
    if (supportGrowth > 0.5 && current.support_volume_7d > 10) {
      insights.push({
        id: `insight-support-spike-${productId}`,
        type: 'warning',
        title: 'Support volume spike',
        body: `Support tickets up ${(supportGrowth * 100).toFixed(0)}% ${over} (${prior.support_volume_7d} → ${current.support_volume_7d}, both seven-day figures). Check if a recent deploy introduced issues or if a new cohort is hitting friction points.`,
        urgency: 'medium',
        generated_at: now,
      });
    }
  }

  return insights;
}
