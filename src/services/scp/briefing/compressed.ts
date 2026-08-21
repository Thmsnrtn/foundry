// =============================================================================
// FOUNDRY — Weekly Compressed Brief Generator
// 15-minute digest for low-engagement users.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';

// ─── ISO Week Helper ──────────────────────────────────────────────────────────

function isoWeek(date: Date): string {
  // Returns e.g. '2026-W14'
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── Generate Compressed Weekly Brief ────────────────────────────────────────

/**
 * Generate (or retrieve existing) compressed weekly brief for a product.
 * Returns the id of the weekly_compressed_briefs row.
 */
export async function generateCompressedWeeklyBrief(productId: string): Promise<string> {
  // 1. Compute week_of
  const weekOf = isoWeek(new Date());

  // 2. Check if already exists for this week
  const existing = await query(
    'SELECT id FROM weekly_compressed_briefs WHERE product_id = ? AND week_of = ?',
    [productId, weekOf]
  );
  if (existing.rows.length > 0) {
    return (existing.rows[0] as Record<string, unknown>).id as string;
  }

  // 3. Load latest metric_snapshot
  let latestMetrics: Record<string, unknown> = {};
  let lastWeekMetrics: Record<string, unknown> = {};
  try {
    const metricsResult = await query(
      'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 2',
      [productId]
    );
    if (metricsResult.rows.length > 0) {
      latestMetrics = metricsResult.rows[0] as Record<string, unknown>;
    }
    if (metricsResult.rows.length > 1) {
      lastWeekMetrics = metricsResult.rows[1] as Record<string, unknown>;
    }
  } catch {
    // metric_snapshots may not have data
  }

  // 4. Load last 7 briefings headlines
  let recentHeadlines: string[] = [];
  try {
    const briefingsResult = await query(
      `SELECT headline, briefing_date FROM scp_briefings
       WHERE product_id = ?
       ORDER BY briefing_date DESC
       LIMIT 7`,
      [productId]
    );
    recentHeadlines = briefingsResult.rows.map(
      (r) => `${(r as Record<string, unknown>).briefing_date}: ${(r as Record<string, unknown>).headline}`
    ) as string[];
  } catch {
    // no briefings yet
  }

  // 5. Load active stressors count
  let stressorCount = 0;
  let stressorSummaries: string[] = [];
  try {
    const stressorsResult = await query(
      `SELECT stressor_name AS type, severity FROM stressor_history
       WHERE product_id = ? AND status = 'active'
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END
       LIMIT 5`,
      [productId]
    );
    stressorCount = stressorsResult.rows.length;
    stressorSummaries = stressorsResult.rows.map(
      (r) => `${(r as Record<string, unknown>).severity} ${(r as Record<string, unknown>).type}`
    ) as string[];
  } catch {
    // no stressors
  }

  // 6. Load pending decisions count
  let pendingDecisionsCount = 0;
  try {
    const decisionsResult = await query(
      `SELECT COUNT(*) as cnt FROM decisions WHERE product_id = ? AND status = 'pending'`,
      [productId]
    );
    pendingDecisionsCount = ((decisionsResult.rows[0] as Record<string, unknown>)?.cnt as number) ?? 0;
  } catch {
    // no decisions table
  }

  // 7. Compute current health score
  let healthScore = 50;
  try {
    const { SCPInstance } = await import('../instance.js');
    healthScore = await new SCPInstance(productId).computeHealthScore();
  } catch {
    // non-fatal
  }

  // 8. Determine health trend by comparing to last week's briefing
  let healthTrend: 'improving' | 'stable' | 'declining' = 'stable';
  try {
    const lastBriefResult = await query(
      `SELECT health_score FROM scp_briefings
       WHERE product_id = ?
       ORDER BY briefing_date DESC
       LIMIT 7`,
      [productId]
    );
    if (lastBriefResult.rows.length >= 3) {
      const scores = lastBriefResult.rows
        .map((r) => (r as Record<string, unknown>).health_score as number | null)
        .filter((s): s is number => s !== null);
      if (scores.length >= 2) {
        const avgOld = scores.slice(Math.floor(scores.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(scores.length / 2);
        const avgNew = scores.slice(0, Math.floor(scores.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(scores.length / 2);
        if (avgNew > avgOld + 3) healthTrend = 'improving';
        else if (avgNew < avgOld - 3) healthTrend = 'declining';
      }
    }
  } catch {
    // non-fatal
  }

  // 9. Compute metrics deltas
  const metricsDelta: Record<string, unknown> = {};
  try {
    const currentMrr = latestMetrics.mrr_cents as number | null;
    const prevMrr = lastWeekMetrics.mrr_cents as number | null;
    if (currentMrr !== null && prevMrr !== null && prevMrr > 0) {
      metricsDelta.mrr_change_pct = Number((((currentMrr - prevMrr) / prevMrr) * 100).toFixed(1));
    }
    const currentChurn = latestMetrics.churn_rate as number | null;
    const prevChurn = lastWeekMetrics.churn_rate as number | null;
    if (currentChurn !== null && prevChurn !== null) {
      metricsDelta.churn_change = Number((currentChurn - prevChurn).toFixed(2));
    }
    const currentActivation = latestMetrics.activation_rate as number | null;
    const prevActivation = lastWeekMetrics.activation_rate as number | null;
    if (currentActivation !== null && prevActivation !== null) {
      metricsDelta.activation_change = Number((currentActivation - prevActivation).toFixed(2));
    }
  } catch {
    // non-fatal
  }

  // 10. Build context for AI synthesis
  // `!= null`, NOT TRUTHINESS. A company that recorded exactly $0 of MRR — a
  // pre-revenue company, which is most of them — reported as 'unknown', which
  // is the same confusion as everything else in this area running backwards.
  const mrrDisplay = latestMetrics.mrr_cents != null
    ? `$${((latestMetrics.mrr_cents as number) / 100).toLocaleString()}`
    : 'unknown';
  const mrrGrowth = latestMetrics.mrr_growth_pct != null
    ? `${(latestMetrics.mrr_growth_pct as number).toFixed(1)}% MoM`
    : 'unknown growth';
  const churnDisplay = latestMetrics.churn_rate != null
    // `* 100`: these are stored as 0–1 fractions (`ux/fluency.ts` names them
    // as such), so 2% churn rendered as "0.0%" in a briefing a founder reads.
    ? `${((latestMetrics.churn_rate as number) * 100).toFixed(1)}%`
    : 'unknown';
  const activationDisplay = latestMetrics.activation_rate != null
    ? `${((latestMetrics.activation_rate as number) * 100).toFixed(1)}%`
    : 'unknown';

  const contextForAI = `
Week: ${weekOf}
Health Score: ${healthScore}/100 (${healthTrend})
MRR: ${mrrDisplay} (${mrrGrowth})
Churn: ${churnDisplay}
Activation Rate: ${activationDisplay}
Active Stressors (${stressorCount}): ${stressorSummaries.join(', ') || 'none'}
Pending Decisions: ${pendingDecisionsCount}

Recent Agent Headlines (last 7 days):
${recentHeadlines.join('\n') || 'No recent briefings.'}
  `.trim();

  // 11. Call Claude to synthesize
  let oneSentenceStatus = `Health score is ${healthScore}/100 this week.`;
  let top3ThisWeek: string[] = ['Review key metrics', 'Check agent recommendations', 'Address pending decisions'];
  let agentConsensus: string | null = null;
  let oneDecisionToMake: string | null = null;

  try {
    const aiResponse = await callSonnet(
      `You are a brutally focused advisor with 3 minutes of a founder's attention.
Generate a compressed weekly brief that contains ONLY what matters.
No fluff. Every word earns its place.
Be specific: use actual numbers when available.`,
      `Based on this company data, generate a compressed weekly brief:\n\n${contextForAI}\n\nReturn ONLY valid JSON in this exact format:
{
  "one_sentence_status": "...",
  "top_3_this_week": ["...", "...", "..."],
  "agent_consensus": "...",
  "one_decision_to_make": "..."
}`,
      512,
      productId
    );

    interface BriefAIResponse {
      one_sentence_status: string;
      top_3_this_week: string[];
      agent_consensus: string;
      one_decision_to_make: string;
    }

    const parsed = parseJSONResponse<BriefAIResponse>(aiResponse.content);
    oneSentenceStatus = parsed.one_sentence_status || oneSentenceStatus;
    top3ThisWeek = Array.isArray(parsed.top_3_this_week) ? parsed.top_3_this_week.slice(0, 3) : top3ThisWeek;
    agentConsensus = parsed.agent_consensus || null;
    oneDecisionToMake = parsed.one_decision_to_make || null;
  } catch {
    // Fall back to defaults — non-fatal
  }

  // 12. INSERT and return id
  const id = nanoid();
  await query(
    `INSERT INTO weekly_compressed_briefs
       (id, product_id, week_of, health_score, health_trend,
        one_sentence_status, top_3_this_week, metrics_delta_json,
        agent_consensus, one_decision_to_make, estimated_read_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, week_of) DO UPDATE SET
       health_score = excluded.health_score,
       health_trend = excluded.health_trend,
       one_sentence_status = excluded.one_sentence_status,
       top_3_this_week = excluded.top_3_this_week,
       metrics_delta_json = excluded.metrics_delta_json,
       agent_consensus = excluded.agent_consensus,
       one_decision_to_make = excluded.one_decision_to_make,
       generated_at = datetime('now')`,
    [
      id,
      productId,
      weekOf,
      healthScore,
      healthTrend,
      oneSentenceStatus,
      JSON.stringify(top3ThisWeek),
      JSON.stringify(metricsDelta),
      agentConsensus,
      oneDecisionToMake,
      3.0,
    ]
  );

  return id;
}

// ─── Get Latest Compressed Brief ─────────────────────────────────────────────

/**
 * Get the most recent weekly compressed brief for a product.
 */
export async function getLatestCompressedBrief(productId: string): Promise<{
  health_score: number;
  health_trend: string;
  one_sentence_status: string;
  top_3: string[];
  metrics_delta: Record<string, unknown>;
  agent_consensus: string | null;
  one_decision_to_make: string | null;
  week_of: string;
  estimated_read_minutes: number;
  generated_at: string;
} | null> {
  const result = await query(
    `SELECT * FROM weekly_compressed_briefs
     WHERE product_id = ?
     ORDER BY week_of DESC
     LIMIT 1`,
    [productId]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0] as Record<string, unknown>;

  let top3: string[] = [];
  try {
    top3 = JSON.parse(r.top_3_this_week as string) as string[];
  } catch {
    top3 = [];
  }

  let metricsDelta: Record<string, unknown> = {};
  try {
    metricsDelta = JSON.parse(r.metrics_delta_json as string) as Record<string, unknown>;
  } catch {
    metricsDelta = {};
  }

  return {
    health_score: (r.health_score as number) ?? 50,
    health_trend: (r.health_trend as string) ?? 'stable',
    one_sentence_status: (r.one_sentence_status as string) ?? '',
    top_3: top3,
    metrics_delta: metricsDelta,
    agent_consensus: r.agent_consensus as string | null,
    one_decision_to_make: r.one_decision_to_make as string | null,
    week_of: r.week_of as string,
    estimated_read_minutes: (r.estimated_read_minutes as number) ?? 3.0,
    generated_at: r.generated_at as string,
  };
}
