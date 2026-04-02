// =============================================================================
// FOUNDRY — Decision Tracker (Outcome Database)
// Tracks every decision and retrospective quality metrics over time.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecisionQualityTrends {
  average_quality_score: number | null;
  decisions_with_full_context_pct: number;
  best_decision_time_of_day: string;
  worst_decision_time_of_day: string;
  override_rate_30d: number;
  override_rate_90d: number;
  trend: 'improving' | 'declining' | 'stable';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hourRangeLabel(hour: number): string {
  const period = (h: number) => (h < 12 ? 'am' : 'pm');
  const fmt = (h: number) => {
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${period(h)}`;
  };
  return `${fmt(hour)}-${fmt(hour + 2)}`;
}

// ─── Trends ──────────────────────────────────────────────────────────────────

/**
 * Computes decision quality trends from the decision_quality_scores table.
 */
export async function getDecisionQualityTrends(productId: string): Promise<DecisionQualityTrends> {
  // Average quality score (all time)
  const avgResult = await query(
    `SELECT AVG(quality_score) as avg_q FROM decision_quality_scores WHERE product_id = ? AND quality_score IS NOT NULL`,
    [productId]
  );
  const average_quality_score =
    (avgResult.rows[0] as Record<string, unknown>)?.avg_q as number | null ?? null;

  // Decisions with full context (context_richness = 3)
  const contextResult = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN context_richness = 3 THEN 1 END) as full_context
     FROM decision_quality_scores
     WHERE product_id = ?`,
    [productId]
  );
  const contextRow = contextResult.rows[0] as Record<string, unknown> | undefined;
  const ctxTotal = (contextRow?.total as number) ?? 0;
  const ctxFull = (contextRow?.full_context as number) ?? 0;
  const decisions_with_full_context_pct = ctxTotal > 0 ? ctxFull / ctxTotal : 0;

  // Best and worst time of day by average quality score
  const timeResult = await query(
    `SELECT time_of_day, AVG(quality_score) as avg_q, COUNT(*) as cnt
     FROM decision_quality_scores
     WHERE product_id = ? AND quality_score IS NOT NULL AND time_of_day IS NOT NULL
     GROUP BY time_of_day
     ORDER BY avg_q DESC`,
    [productId]
  );
  const timeRows = timeResult.rows as Array<Record<string, unknown>>;
  const best_decision_time_of_day =
    timeRows.length > 0 ? hourRangeLabel(timeRows[0].time_of_day as number) : 'Insufficient data';
  const worst_decision_time_of_day =
    timeRows.length > 1 ? hourRangeLabel(timeRows[timeRows.length - 1].time_of_day as number) : 'Insufficient data';

  // Override rates — 30d and 90d
  const overrideResult = await query(
    `SELECT
       COUNT(CASE WHEN scored_at >= datetime('now', '-30 days') THEN 1 END) as total_30d,
       COUNT(CASE WHEN scored_at >= datetime('now', '-30 days') AND decision_source = 'override' THEN 1 END) as overrides_30d,
       COUNT(CASE WHEN scored_at >= datetime('now', '-90 days') THEN 1 END) as total_90d,
       COUNT(CASE WHEN scored_at >= datetime('now', '-90 days') AND decision_source = 'override' THEN 1 END) as overrides_90d
     FROM decision_quality_scores
     WHERE product_id = ?`,
    [productId]
  );
  const overrideRow = overrideResult.rows[0] as Record<string, unknown> | undefined;
  const total30d = (overrideRow?.total_30d as number) ?? 0;
  const overrides30d = (overrideRow?.overrides_30d as number) ?? 0;
  const total90d = (overrideRow?.total_90d as number) ?? 0;
  const overrides90d = (overrideRow?.overrides_90d as number) ?? 0;
  const override_rate_30d = total30d > 0 ? overrides30d / total30d : 0;
  const override_rate_90d = total90d > 0 ? overrides90d / total90d : 0;

  // Trend: compare average quality in last 30d vs prior 30d
  const trendResult = await query(
    `SELECT
       AVG(CASE WHEN scored_at >= datetime('now', '-30 days') THEN quality_score END) as recent_avg,
       AVG(CASE WHEN scored_at < datetime('now', '-30 days') AND scored_at >= datetime('now', '-60 days') THEN quality_score END) as prior_avg
     FROM decision_quality_scores
     WHERE product_id = ? AND quality_score IS NOT NULL`,
    [productId]
  );
  const trendRow = trendResult.rows[0] as Record<string, unknown> | undefined;
  const recentAvg = trendRow?.recent_avg as number | null;
  const priorAvg = trendRow?.prior_avg as number | null;

  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (recentAvg !== null && priorAvg !== null) {
    const delta = recentAvg - priorAvg;
    if (delta > 0.3) trend = 'improving';
    else if (delta < -0.3) trend = 'declining';
  }

  return {
    average_quality_score,
    decisions_with_full_context_pct,
    best_decision_time_of_day,
    worst_decision_time_of_day,
    override_rate_30d,
    override_rate_90d,
    trend,
  };
}

// ─── Record Decision Context ──────────────────────────────────────────────────

/**
 * Records the context richness for a decision, used when a decision is made.
 */
export async function recordDecisionContext(
  productId: string,
  data: {
    source: 'action_execution' | 'strategic_decision' | 'override';
    source_id: string;
    context_richness: 0 | 1 | 2 | 3;
  }
): Promise<void> {
  const now = new Date();
  const time_of_day = now.getUTCHours();

  await query(
    `INSERT INTO decision_quality_scores
       (id, product_id, decision_source, source_id, context_richness, time_of_day, outcome)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [nanoid(), productId, data.source, data.source_id, data.context_richness, time_of_day]
  );
}
