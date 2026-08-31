// =============================================================================
// FOUNDRY — Digest Generator
// =============================================================================

import { callOpus, callSonnet } from '../ai/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../intelligence/revenue.js';
import { getLatestCohortSummary } from '../intelligence/cohort.js';
import { getFounderHealthSummary, generateFounderHealthDigestSection } from '../intelligence/founder-health.js';
import { getStageConfig } from '../lifecycle/stage-detection.js';
import { query, getActiveStressors, getLatestMetrics } from '../../db/client.js';
import { measured, pctOfFraction } from '../ai/measured.js';
import type { Digest, RiskStateValue, StressorReportItem, DashboardMetrics, MRRDecomposition, MRRHealthRatio, CohortSummary, RiskState, GrowthStage } from '../../types/index.js';

export async function generateDigest(
  productId: string,
  riskState: RiskStateValue,
  digestType: 'weekly' | 'yellow_pulse' | 'red_daily'
): Promise<Digest> {
  const mrr = await getMRRDecomposition(productId);
  // A COMPANY WITH NO REVENUE DATA IS NOT A HEALTHY ONE. `computeHealthRatio`
  // was deliberately changed to return `{ value: null, indicator: 'unknown' }`
  // — its comment says "a company with no new MRR to divide by got a ratio of 0
  // and an indicator of GREEN, the most reassuring answer available, for the
  // absence of the measurement" — and this call site handed back green/0 anyway
  // whenever there was no decomposition at all, re-introducing the defect one
  // level up. `MRRHealthRatio.indicator` carries 'unknown' for exactly this.
  const mrrHealth = mrr
    ? computeHealthRatio(mrr)
    : { value: null, indicator: 'unknown' as const };
  const cohort = await getLatestCohortSummary(productId);
  const metricsResult = await getLatestMetrics(productId);
  const metricsRow = metricsResult.rows[0] as Record<string, unknown> | undefined;

  // ONE NULL, SUBSTITUTED IN OPPOSITE DIRECTIONS INSIDE ONE OBJECT LITERAL.
  //
  // These four columns are nullable REAL with no default, and the daily job
  // writes a placeholder snapshot carrying only (id, product_id, snapshot_date)
  // — which `getLatestMetrics` then returns as the latest row. So on the
  // ordinary weekly path every one of them was NULL, and `?? 0` turned churn
  // into FLAWLESS RETENTION while turning activation and day-30 retention into
  // TOTAL PRODUCT FAILURE. The same absence, read as the best possible news and
  // the worst possible news, in adjacent lines.
  //
  // It then went to a model as ground truth and to the founder's inbox as
  // "Activation: 0.0%". `services/ai/measured.ts` exists because four agents did
  // this with the same columns; its header says so. This was the fifth reader,
  // and the only one whose output is emailed.
  const n = (v: unknown): number | null =>
    (v === null || v === undefined ? null : Number(v));
  const metrics: DashboardMetrics = {
    signups_7d: n(metricsRow?.signups_7d),
    active_users: n(metricsRow?.active_users),
    activation_rate: n(metricsRow?.activation_rate),
    day_30_retention: n(metricsRow?.day_30_retention),
    support_volume_7d: n(metricsRow?.support_volume_7d),
    nps_score: n(metricsRow?.nps_score),
    churn_rate: n(metricsRow?.churn_rate),
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

  // Get product growth stage and lifestyle mode for context
  const productRow = await query('SELECT growth_stage, owner_id FROM products WHERE id = ?', [productId]);
  const product = productRow.rows[0] as Record<string, string> | undefined;
  const growthStage = (product?.growth_stage as GrowthStage) ?? 'growth';
  const stageConfig = getStageConfig(growthStage);

  // Check lifestyle mode
  const founderRow = product?.owner_id
    ? await query('SELECT lifestyle_mode FROM founders WHERE id = ?', [product.owner_id])
    : { rows: [] };
  const isLifestyle = ((founderRow.rows[0] as Record<string, number> | undefined)?.lifestyle_mode ?? 0) === 1;

  // Generate narrative with stage context
  const narrative = await generateNarrative(productId, riskState, metrics, mrr, stressors, digestType, stageConfig.digestFocus, isLifestyle);

  // Optional founder health section
  let founderHealthSection: string | null = null;
  if (product?.owner_id) {
    const health = await getFounderHealthSummary(product.owner_id);
    if (health) {
      founderHealthSection = generateFounderHealthDigestSection(health);
    }
  }

  // Append founder health to narrative if present
  const fullNarrative = founderHealthSection
    ? narrative + '\n\n---\n\n' + founderHealthSection
    : narrative;

  return {
    risk_state: riskInfo,
    stressor_report: { stressors, evaluation_context: { mrr_health_ratio: mrr?.health_ratio ?? null, mrr_health_trend: null, latest_cohort_retention_vs_avg: cohort?.vs_historical_average_14 ?? null, high_significance_competitive_signals: compResult.rows.length }, generated_at: new Date().toISOString() },
    competitive_context: competitiveContext,
    narrative: fullNarrative,
    // The fallback used to carry `total_cents: 0`, which the digest email then
    // printed as "Total MRR: $0.00" for a company with no snapshot at all.
    mrr: mrr ?? {
      new_cents: 0, expansion_cents: 0, contraction_cents: 0, churned_cents: 0,
      net_new_cents: 0, level_cents: null, health_ratio: null,
    },
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
  digestType: string,
  stageFocus?: string,
  isLifestyle?: boolean
): Promise<string> {
  const model = digestType === 'weekly' ? callOpus : callSonnet;

  let systemInstruction = 'You are a COO writing a weekly business briefing. Be concise and direct.';
  if (isLifestyle) {
    systemInstruction = 'You are a COO writing a weekly briefing for a founder in lifestyle mode. Focus on profitability, customer satisfaction, and operational efficiency. No growth pressure language.';
  }

  let prompt = `Write a 3-5 sentence COO summary of this product's week.
Risk state: ${riskState}
Metrics: signups (7d) ${measured(metrics.signups_7d)}, active users ${measured(metrics.active_users)}, activation ${pctOfFraction(metrics.activation_rate)}, day-30 retention ${pctOfFraction(metrics.day_30_retention)}, churn ${pctOfFraction(metrics.churn_rate)}, NPS ${measured(metrics.nps_score)}, support volume (7d) ${measured(metrics.support_volume_7d)}
MRR: ${JSON.stringify(mrr)}
Active stressors: ${stressors.length > 0 ? stressors.map((s) => s.name).join(', ') : 'None'}`;

  if (stageFocus) {
    prompt += `\nStage focus: ${stageFocus}`;
  }

  prompt += '\nBe direct and specific. What happened and what it means.';

  const response = await model(systemInstruction, prompt, 512, productId);
  return response.content;
}
