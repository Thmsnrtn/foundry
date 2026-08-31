// =============================================================================
// FOUNDRY — Product Health Score
// A single number that captures everything about your product's state.
// Like a credit score for your SaaS — simple, memorable, actionable.
// =============================================================================

import { getLatestAudit, getActiveStressors, getLatestMetrics, getPendingDecisions, getLifecycleState } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from './revenue.js';
import type { RiskStateValue } from '../../types/index.js';

/**
 * A GRADE FOR A COMPANY NOBODY HAD MEASURED.
 *
 * Every component substituted a number when it had nothing, and every one of
 * them substituted in a different direction:
 *
 *   audit       `composite ?? 0` → 0/100 for a company never audited, at 35%
 *               weight. The LABEL said "Not run" — the label told the truth and
 *               the number did not, and the number is what was weighted.
 *   revenue     a null health ratio became 0, which `(1 - value) * 100` turned
 *               into 100/100. The best possible revenue score for the absence
 *               of new MRR to divide by.
 *   risk        `risk_state ?? 'green'` — no lifecycle state read as healthy,
 *               and with no stressors recorded that is 100/100.
 *   engagement  a default of 100 with deductions, so a company with nothing to
 *               deduct from scored high.
 *
 * A brand-new company came out around 57 — grade C, "Mixed signals. Some
 * components need attention." A verdict, in an MCP tool result an outside model
 * reads, about a company with no data at all.
 *
 * Components now contribute only when measured, the weights are renormalised
 * over those that were, and `coverage` says how much of the full weighting the
 * score rests on. Null when nothing was measured — the same shape the Value
 * Delivery Index was given for the same reason.
 */
export interface HealthScore {
  /** Null when no component could be measured. */
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  /** Share of the full weighting that was measured, 0-1. Null when none was. */
  coverage: number | null;
  trend: 'improving' | 'stable' | 'declining' | 'new';
  components: {
    audit: { score: number | null; weight: number; label: string };
    revenue: { score: number | null; weight: number; label: string };
    risk: { score: number | null; weight: number; label: string };
    engagement: { score: number | null; weight: number; label: string };
  };
  headline: string;
  summary: string;
}

/**
 * Calculate a single Product Health Score (0-100) from all available signals.
 *
 * Components (weighted):
 * - Audit composite (35%): Most recent audit score mapped to 0-100
 * - Revenue health (25%): MRR health ratio inverted (lower ratio = healthier)
 * - Risk posture (25%): Based on risk state + stressor count
 * - Engagement (15%): Metric freshness + decision responsiveness
 */
export async function calculateHealthScore(productId: string): Promise<HealthScore> {
  const [auditResult, stressors, metrics, decisions, lsResult, mrr] = await Promise.all([
    getLatestAudit(productId),
    getActiveStressors(productId),
    getLatestMetrics(productId),
    getPendingDecisions(productId),
    getLifecycleState(productId),
    getMRRDecomposition(productId),
  ]);

  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  // No lifecycle state is not a green one.
  const riskState = ls?.risk_state == null ? null : ls.risk_state as RiskStateValue;

  // ─── Audit Component (35%) ──────────────────────────────────────────────
  const audit = auditResult.rows[0] as Record<string, unknown> | undefined;
  const composite = audit?.composite == null ? null : Number(audit.composite);
  const auditScore = composite === null ? null : Math.min(100, (composite / 10) * 100);
  const auditLabel = composite === null ? 'Not run' : `${composite.toFixed(1)}/10`;

  // ─── Revenue Component (25%) ────────────────────────────────────────────
  const mrrHealth = mrr ? computeHealthRatio(mrr) : null;
  // Health ratio: lower is better. 0 = perfect, 1.0+ = critical.
  const revenueScore = mrrHealth?.value == null
    ? null
    : Math.max(0, Math.min(100, (1 - mrrHealth.value) * 100));
  const revenueLabel = mrrHealth?.value == null
    ? 'No new MRR to divide by'
    : `${mrrHealth.value.toFixed(2)} ratio`;

  // ─── Risk Component (25%) ───────────────────────────────────────────────
  const stressorCount = stressors.rows.length;
  const criticalCount = stressors.rows.filter((s) => (s as Record<string, string>).severity === 'critical').length;
  const riskScore = riskState === null
    ? null
    : riskState === 'red' ? 15
      : riskState === 'yellow' ? 55
        : Math.max(60, 100 - (stressorCount * 10) - (criticalCount * 15));
  const riskLabel = riskState === null
    ? 'No lifecycle state'
    : riskState === 'green' ? (stressorCount > 0 ? `${stressorCount} stressors` : 'Clear') : riskState.toUpperCase();

  // ─── Engagement Component (15%) ─────────────────────────────────────────
  const metricsRow = metrics.rows[0] as Record<string, unknown> | undefined;
  const lastMetricDate = metricsRow?.snapshot_date as string | undefined;
  const metricAgeDays = lastMetricDate ? Math.floor((Date.now() - new Date(lastMetricDate).getTime()) / 86400000) : 999;
  const pendingDecisions = decisions.rows.length;
  const oldDecisions = decisions.rows.filter((d) => {
    const created = new Date((d as Record<string, string>).created_at).getTime();
    return Date.now() - created > 7 * 86400000;
  }).length;

  // Engagement is about freshness and responsiveness. With no metric snapshot
  // and no decisions there is nothing to be fresh or responsive ABOUT, and a
  // default of 100 with nothing to deduct from scored such a company well.
  const hasEngagementEvidence = metricsRow !== undefined || decisions.rows.length > 0;
  let engagementScore: number | null = null;
  if (hasEngagementEvidence) {
    let e = 100;
    if (metricAgeDays > 14) e -= 30;
    else if (metricAgeDays > 7) e -= 15;
    if (oldDecisions > 0) e -= (oldDecisions * 10);
    if (!audit) e -= 20;
    engagementScore = Math.max(0, e);
  }
  const engagementLabel = !hasEngagementEvidence
    ? 'Nothing to measure yet'
    : metricAgeDays < 999 ? `${metricAgeDays}d old` : 'No metrics';

  // ─── Weighted Total, over what was measured ─────────────────────────────
  const weighted: Array<[number | null, number]> = [
    [auditScore, 0.35], [revenueScore, 0.25], [riskScore, 0.25], [engagementScore, 0.15],
  ];
  let sum = 0;
  let weightUsed = 0;
  for (const [value, weight] of weighted) {
    if (value === null) continue;
    sum += value * weight;
    weightUsed += weight;
  }
  const score = weightUsed === 0 ? null : Math.round(sum / weightUsed);
  const coverage = weightUsed === 0 ? null : weightUsed;

  const grade: HealthScore['grade'] = score === null ? null
    : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  // Headline
  const headlines: Record<Exclude<HealthScore['grade'], null>, string> = {
    A: 'Your product is operating at peak health.',
    B: 'Solid foundation. A few areas to strengthen.',
    C: 'Mixed signals. Some components need attention.',
    D: 'Significant gaps. Focus on blocking issues.',
    F: 'Critical state. Immediate action required.',
  };

  // Summary
  const issues: string[] = [];
  if (auditScore !== null && auditScore < 60) issues.push('audit score below launch readiness');
  if (revenueScore !== null && revenueScore < 50) issues.push('revenue health ratio elevated');
  if (riskScore !== null && riskScore < 60) issues.push('active risk signals');
  if (engagementScore !== null && engagementScore < 60) issues.push('stale metrics or pending decisions');

  const unmeasured = [
    auditScore === null ? 'audit' : null,
    revenueScore === null ? 'revenue' : null,
    riskScore === null ? 'risk' : null,
    engagementScore === null ? 'engagement' : null,
  ].filter((x): x is string => x !== null);

  const summary = score === null
    ? 'Nothing has been measured for this company yet, so there is no health score.'
    : [
      issues.length > 0 ? `Focus areas: ${issues.join(', ')}.` : 'All measured systems healthy.',
      unmeasured.length > 0
        ? `Not measured: ${unmeasured.join(', ')} — the score rests on ${Math.round((coverage ?? 0) * 100)}% of its weighting.`
        : null,
    ].filter(Boolean).join(' ');

  const round = (n: number | null): number | null => n === null ? null : Math.round(n);

  return {
    score,
    grade,
    coverage,
    trend: 'new', // TODO: compare to prior week
    components: {
      audit: { score: round(auditScore), weight: 35, label: auditLabel },
      revenue: { score: round(revenueScore), weight: 25, label: revenueLabel },
      risk: { score: round(riskScore), weight: 25, label: riskLabel },
      engagement: { score: round(engagementScore), weight: 15, label: engagementLabel },
    },
    headline: grade === null
      ? 'Not enough has been measured to grade this company.'
      : headlines[grade],
    summary,
  };
}
