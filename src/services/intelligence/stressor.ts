// =============================================================================
// FOUNDRY — Stressor Identification Engine
// Identifies forward-looking risks from metrics, cohorts, competitive signals, MRR.
// =============================================================================

import { query } from '../../db/client.js';
import { getRelevantFailures } from '../wisdom/failures.js';
import { nanoid } from 'nanoid';
import { getStageConfig, getStageStressorThresholds } from '../lifecycle/stage-detection.js';
import type { Stressor, StressorReport, StressorReportItem, StressorSeverity, RiskStateValue, MetricSnapshot, MRRDecomposition, CohortSummary, CompetitiveSignal, GrowthStage } from '../../types/index.js';
import { pctOfFraction } from '../ai/measured.js';

export interface StressorInputs {
  productId: string;
  currentMetrics: MetricSnapshot | null;
  priorMetrics: MetricSnapshot | null;
  mrrDecomposition: MRRDecomposition | null;
  latestCohort: CohortSummary | null;
  /** Per day, because a cohort may have reported one horizon and not another. */
  historicalAvgRetention: { day_14: number | null; day_30: number | null } | null;
  highSignificanceSignals: CompetitiveSignal[];
  riskState: RiskStateValue;
  growthStage?: GrowthStage;
  lifestyleMode?: boolean;
}

/**
 * Identify stressors from current data. Returns structured report.
 */
export async function identifyStressors(inputs: StressorInputs): Promise<StressorReport> {
  const items: StressorReportItem[] = [];
  const stage = inputs.growthStage ?? 'growth';
  const stageConfig = getStageConfig(stage);
  const thresholds = getStageStressorThresholds(stage);

  // In lifestyle mode, suppress growth-oriented stressors
  const isLifestyle = inputs.lifestyleMode === true;

  // 1. MRR Health Ratio evaluation
  if (inputs.mrrDecomposition && inputs.mrrDecomposition.health_ratio !== null) {
    const ratio = inputs.mrrDecomposition.health_ratio;
    // Skip if stage suppresses this stressor
    if (!stageConfig.suppressedStressors.includes('mrr_health_ratio')) {
      if (ratio >= thresholds.mrrHealthRatioCritical) {
        items.push({
          name: 'Revenue drain exceeds acquisition',
          signal: `MRR Health Ratio at ${ratio.toFixed(2)} — churned revenue exceeds new revenue`,
          timeframe_days: 30,
          neutralizing_action: 'Immediate churn root cause analysis. Pause expansion efforts until churn stabilized.',
          severity: 'critical',
          competitive_correlation: null,
        });
      } else if (ratio >= thresholds.mrrHealthRatioElevated) {
        items.push({
          name: 'Churn approaching new revenue',
          signal: `MRR Health Ratio at ${ratio.toFixed(2)} — churn is ${Math.round(ratio * 100)}% of new revenue`,
          timeframe_days: 60,
          neutralizing_action: 'Investigate churn patterns by cohort and plan. Identify high-churn segments.',
          severity: 'elevated',
          competitive_correlation: null,
        });
      } else if (ratio >= 0.6 * stageConfig.stressorThresholdMultiplier) {
        items.push({
          name: 'MRR health ratio rising',
          signal: `MRR Health Ratio at ${ratio.toFixed(2)} — worth monitoring`,
          timeframe_days: 90,
          neutralizing_action: 'Review churn by cohort and feature usage correlation.',
          severity: 'watch',
          competitive_correlation: null,
        });
      }
    }
  }

  // 2. Cohort retention deviation (skip if stage suppresses)
  //
  // A COHORT WITH NOBODY IN IT HAS NO RETENTION TO HAVE DROPPED. This guarded
  // the historical average but not the cohort's own figure, and that figure was
  // a substituted 0 whenever `founder_count` was zero — so the deviation came
  // out as the whole average and this raised "Severe cohort retention drop" at
  // CRITICAL severity about a cohort that had no one to retain. The measurement
  // says null now, and a stressor is a finding, so it needs one.
  if (!stageConfig.suppressedStressors.includes('cohort_retention')
      && inputs.latestCohort?.retention_day_14 != null
      && inputs.historicalAvgRetention?.day_14 != null) {
    const latestDay14 = inputs.latestCohort.retention_day_14;
    const avgDay14 = inputs.historicalAvgRetention.day_14;
    const deviation14 = avgDay14 - latestDay14;
    if (deviation14 >= thresholds.cohortRetentionDeviation) {
      items.push({
        name: 'Severe cohort retention drop',
        signal: `Latest cohort day-14 retention ${latestDay14.toFixed(1)}% vs average ${avgDay14.toFixed(1)}% (${deviation14.toFixed(0)}pt gap)`,
        timeframe_days: 30,
        neutralizing_action: 'Investigate acquisition channel quality shift. Check onboarding completion rates for latest cohort.',
        severity: 'critical',
        competitive_correlation: null,
      });
    } else if (deviation14 >= 15 * stageConfig.stressorThresholdMultiplier) {
      items.push({
        name: 'Cohort retention declining',
        signal: `Latest cohort day-14 retention ${deviation14.toFixed(0)} points below average`,
        timeframe_days: 45,
        neutralizing_action: 'Compare activation paths between latest and best-performing cohorts.',
        severity: 'elevated',
        competitive_correlation: null,
      });
    }
  }

  // 3. Competitive signal stressors
  for (const signal of inputs.highSignificanceSignals) {
    items.push({
      name: `Competitive threat: ${signal.competitor_name}`,
      signal: signal.signal_summary,
      timeframe_days: 60,
      neutralizing_action: 'Evaluate competitive response options. Prioritize differentiation over matching.',
      severity: 'elevated',
      competitive_correlation: signal.id,
    });
  }

  // 4. Metric trend stressors
  if (inputs.currentMetrics && inputs.priorMetrics) {
    // Activation rate decline
    if (inputs.currentMetrics.activation_rate !== null && inputs.priorMetrics.activation_rate !== null) {
      // A FRACTION MEASURED AGAINST A THRESHOLD IN POINTS.
      //
      // `metric_snapshots.activation_rate` is a 0–1 fraction and
      // `activationRateDrop` is ten PERCENTAGE POINTS, so the test was "did
      // activation fall by ten whole multiples of itself" and this stressor
      // could never fire for anyone. Its own message would then have printed
      // the fraction with a per cent sign — 0.4 as "0.4%" — which is the tell
      // that the two scales were never reconciled anywhere in the block.
      //
      // The drop is converted to points, because the threshold is the thing a
      // person reads and "a ten-point drop in activation" is what it means.
      const dropPoints = (inputs.priorMetrics.activation_rate - inputs.currentMetrics.activation_rate) * 100;
      if (dropPoints >= thresholds.activationRateDrop) {
        items.push({
          name: 'Activation rate erosion',
          signal: `Activation rate dropped from ${pctOfFraction(inputs.priorMetrics.activation_rate)} to ${pctOfFraction(inputs.currentMetrics.activation_rate)}`,
          timeframe_days: 45,
          neutralizing_action: 'Audit onboarding funnel. Identify drop-off step.',
          severity: dropPoints >= 20 * stageConfig.stressorThresholdMultiplier ? 'critical' : 'elevated',
          competitive_correlation: null,
        });
      }
    }
  }

  // 5. Lifestyle mode: suppress growth-oriented stressors, keep retention/quality/operational
  if (isLifestyle) {
    const growthStressors = ['slow_growth', 'flat_mrr', 'low_expansion', 'Revenue drain exceeds acquisition'];
    // Only keep stressors related to retention, quality, and operational health
    const filtered = items.filter((item) => {
      const isGrowthOriented = growthStressors.some((gs) => item.name.toLowerCase().includes(gs.toLowerCase()));
      return !isGrowthOriented;
    });
    items.length = 0;
    items.push(...filtered);
  }

  // Enrich with failure context
  for (const item of items) {
    const category = mapStressorToFailureCategory(item.name);
    if (category) {
      const failures = await getRelevantFailures(inputs.productId, category);
      if (failures.length > 0) {
        const priorAttempts = failures.map((f) => f.what_was_tried).join(', ');
        item.neutralizing_action += ` Prior attempt at ${priorAttempts} did not resolve this — consider an alternative approach.`;
      }
    }
  }

  // Persist new stressors
  for (const item of items) {
    await query(
      `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status, risk_state_at_identification)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [nanoid(), inputs.productId, item.name, item.signal, item.timeframe_days, item.neutralizing_action, item.severity, inputs.riskState]
    );
  }

  // Sort by severity
  const severityOrder: Record<StressorSeverity, number> = { critical: 1, elevated: 2, watch: 3 };
  items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    stressors: items as StressorReportItem[],
    evaluation_context: {
      mrr_health_ratio: inputs.mrrDecomposition?.health_ratio ?? null,
      mrr_health_trend: null, // Computed from historical snapshots
      latest_cohort_retention_vs_avg: inputs.latestCohort?.vs_historical_average_14 ?? null,
      high_significance_competitive_signals: inputs.highSignificanceSignals.length,
    },
    generated_at: new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapStressorToFailureCategory(stressorName: string): string | null {
  const lower = stressorName.toLowerCase();
  if (lower.includes('churn') || lower.includes('revenue drain') || lower.includes('health ratio')) return 'retention';
  if (lower.includes('retention') || lower.includes('cohort')) return 'retention';
  if (lower.includes('activation') || lower.includes('onboarding')) return 'activation';
  if (lower.includes('competitive') || lower.includes('threat')) return 'competitive';
  if (lower.includes('pricing') || lower.includes('conversion')) return 'pricing';
  return null;
}
