// =============================================================================
// FOUNDRY — Product Health Score
// A single number that captures everything about your product's state.
// Like a credit score for your SaaS — simple, memorable, actionable.
// =============================================================================

import { getLatestAudit, getActiveStressors, getLatestMetrics, getPendingDecisions, getLifecycleState } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from './revenue.js';
import type { RiskStateValue } from '../../types/index.js';

export interface HealthScore {
  score: number;            // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  trend: 'improving' | 'stable' | 'declining' | 'new';
  components: {
    audit: { score: number; weight: number; label: string };
    revenue: { score: number; weight: number; label: string };
    risk: { score: number; weight: number; label: string };
    engagement: { score: number; weight: number; label: string };
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
  const riskState = (ls?.risk_state as RiskStateValue) ?? 'green';

  // ─── Audit Component (35%) ──────────────────────────────────────────────
  const audit = auditResult.rows[0] as Record<string, unknown> | undefined;
  const composite = (audit?.composite as number) ?? 0;
  const auditScore = Math.min(100, (composite / 10) * 100); // 0-10 → 0-100
  const auditLabel = composite > 0 ? `${composite.toFixed(1)}/10` : 'Not run';

  // ─── Revenue Component (25%) ────────────────────────────────────────────
  const mrrHealth = mrr ? computeHealthRatio(mrr) : null;
  let revenueScore = 50; // Default if no data
  if (mrrHealth) {
    // Health ratio: lower is better. 0 = perfect, 1.0+ = critical
    revenueScore = Math.max(0, Math.min(100, (1 - mrrHealth.value) * 100));
  }
  const revenueLabel = mrrHealth ? `${mrrHealth.value.toFixed(2)} ratio` : 'No data';

  // ─── Risk Component (25%) ───────────────────────────────────────────────
  const stressorCount = stressors.rows.length;
  const criticalCount = stressors.rows.filter((s) => (s as Record<string, string>).severity === 'critical').length;
  let riskScore = 100;
  if (riskState === 'red') riskScore = 15;
  else if (riskState === 'yellow') riskScore = 55;
  else riskScore = Math.max(60, 100 - (stressorCount * 10) - (criticalCount * 15));
  const riskLabel = riskState === 'green' ? (stressorCount > 0 ? `${stressorCount} stressors` : 'Clear') : riskState.toUpperCase();

  // ─── Engagement Component (15%) ─────────────────────────────────────────
  const metricsRow = metrics.rows[0] as Record<string, unknown> | undefined;
  const lastMetricDate = metricsRow?.snapshot_date as string | undefined;
  const metricAgeDays = lastMetricDate ? Math.floor((Date.now() - new Date(lastMetricDate).getTime()) / 86400000) : 999;
  const pendingDecisions = decisions.rows.length;
  const oldDecisions = decisions.rows.filter((d) => {
    const created = new Date((d as Record<string, string>).created_at).getTime();
    return Date.now() - created > 7 * 86400000;
  }).length;

  let engagementScore = 100;
  if (metricAgeDays > 14) engagementScore -= 30;
  else if (metricAgeDays > 7) engagementScore -= 15;
  if (oldDecisions > 0) engagementScore -= (oldDecisions * 10);
  if (!audit) engagementScore -= 20;
  engagementScore = Math.max(0, engagementScore);
  const engagementLabel = metricAgeDays < 999 ? `${metricAgeDays}d old` : 'No metrics';

  // ─── Weighted Total ─────────────────────────────────────────────────────
  const score = Math.round(
    (auditScore * 0.35) +
    (revenueScore * 0.25) +
    (riskScore * 0.25) +
    (engagementScore * 0.15)
  );

  const grade: HealthScore['grade'] = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  // Headline
  const headlines: Record<HealthScore['grade'], string> = {
    A: 'Your product is operating at peak health.',
    B: 'Solid foundation. A few areas to strengthen.',
    C: 'Mixed signals. Some components need attention.',
    D: 'Significant gaps. Focus on blocking issues.',
    F: 'Critical state. Immediate action required.',
  };

  // Summary
  const issues: string[] = [];
  if (auditScore < 60) issues.push('audit score below launch readiness');
  if (revenueScore < 50) issues.push('revenue health ratio elevated');
  if (riskScore < 60) issues.push('active risk signals');
  if (engagementScore < 60) issues.push('stale metrics or pending decisions');
  const summary = issues.length > 0
    ? `Focus areas: ${issues.join(', ')}.`
    : 'All systems healthy. Keep monitoring your weekly digest.';

  return {
    score,
    grade,
    trend: 'new', // TODO: compare to prior week
    components: {
      audit: { score: Math.round(auditScore), weight: 35, label: auditLabel },
      revenue: { score: Math.round(revenueScore), weight: 25, label: revenueLabel },
      risk: { score: Math.round(riskScore), weight: 25, label: riskLabel },
      engagement: { score: Math.round(engagementScore), weight: 15, label: engagementLabel },
    },
    headline: headlines[grade],
    summary,
  };
}
