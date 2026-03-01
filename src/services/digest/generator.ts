// =============================================================================
// FOUNDRY — Digest Generator
// =============================================================================

import { callOpus, callSonnet } from '../ai/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../intelligence/revenue.js';
import { getLatestCohortSummary } from '../intelligence/cohort.js';
import { query, getActiveStressors, getLatestMetrics } from '../../db/client.js';
import type { Digest, RiskStateValue, StressorReportItem, DashboardMetrics, MRRDecomposition, MRRHealthRatio, CohortSummary, RiskState } from '../../types/index.js';

export async function generateDigest(
  productId: string,
  riskState: RiskStateValue,
  digestType: 'weekly' | 'yellow_pulse' | 'red_daily'
): Promise<Digest> {
  const mrr = await getMRRDecomposition(productId);
  const mrrHealth = mrr ? computeHealthRatio(mrr) : { value: 0, indicator: 'green' as const };
  const cohort = await getLatestCohortSummary(productId);
  const metricsResult = await getLatestMetrics(productId);
  const metricsRow = metricsResult.rows[0] as Record<string, unknown> | undefined;

  const metrics: DashboardMetrics = {
    signups_7d: (metricsRow?.signups_7d as number) ?? 0,
    active_users: (metricsRow?.active_users as number) ?? 0,
    activation_rate: (metricsRow?.activation_rate as number) ?? 0,
    day_30_retention: (metricsRow?.day_30_retention as number) ?? 0,
    support_volume_7d: (metricsRow?.support_volume_7d as number) ?? 0,
    nps_score: (metricsRow?.nps_score as number) ?? 0,
    churn_rate: (metricsRow?.churn_rate as number) ?? 0,
  };

  // Get stressors
  const stressorResult = await getActiveStressors(productId);
  const stressors: StressorReportItem[] = (stressorResult.rows as unknown as Array<Record<string, unknown>>).map((s) => ({
    name: s.stressor_name as string,
    signal: s.signal as string,
    timeframe_days: s.timeframe_days as number,
    neutralizing_action: s.neutralizing_action as string,
    severity: s.severity as StressorReportItem['severity'],
    competitive_correlation: s.linked_stressor_id as string | null,
  }));

  // Get risk state info
  const lsResult = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const riskInfo: RiskState = {
    state: riskState,
    reason: (ls?.risk_state_reason as string) ?? 'No risk signals detected.',
    changed_at: (ls?.risk_state_changed_at as string) ?? null,
  };

  // Competitive context
  const compResult = await query(
    `SELECT * FROM competitive_signals WHERE product_id = ? AND significance IN ('medium', 'high') AND detected_at > datetime('now', '-7 days')`,
    [productId]
  );
  const competitiveContext = compResult.rows.length > 0
    ? (compResult.rows as unknown as Array<Record<string, string>>)
        .map((s) => `${s.competitor_name}: ${s.signal_summary}`)
        .join('\n')
    : null;

  // Generate narrative
  const narrative = await generateNarrative(productId, riskState, metrics, mrr, stressors, digestType);

  return {
    risk_state: riskInfo,
    stressor_report: { stressors, evaluation_context: { mrr_health_ratio: mrr?.health_ratio ?? null, mrr_health_trend: null, latest_cohort_retention_vs_avg: cohort?.vs_historical_average_14 ?? null, high_significance_competitive_signals: compResult.rows.length }, generated_at: new Date().toISOString() },
    competitive_context: competitiveContext,
    narrative,
    mrr: mrr ?? { new_cents: 0, expansion_cents: 0, contraction_cents: 0, churned_cents: 0, total_cents: 0, health_ratio: null },
    mrr_health: mrrHealth,
    metrics,
    cohort_snapshot: cohort,
    generated_at: new Date().toISOString(),
    digest_type: digestType,
  };
}

async function generateNarrative(
  productId: string,
  riskState: RiskStateValue,
  metrics: DashboardMetrics,
  mrr: MRRDecomposition | null,
  stressors: StressorReportItem[],
  digestType: string
): Promise<string> {
  const model = digestType === 'weekly' ? callOpus : callSonnet;
  const prompt = `Write a 3-5 sentence COO summary of this product's week.
Risk state: ${riskState}
Metrics: ${JSON.stringify(metrics)}
MRR: ${JSON.stringify(mrr)}
Active stressors: ${stressors.length > 0 ? stressors.map((s) => s.name).join(', ') : 'None'}
Be direct and specific. What happened and what it means.`;

  const response = await model('You are a COO writing a weekly business briefing. Be concise and direct.', prompt, 512);
  return response.content;
}
