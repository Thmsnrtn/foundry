// =============================================================================
// FOUNDRY — Briefing → Decision Telemetry (Wave 1, Action 1)
// Captures the loop: founder views briefing → approves/rejects a decision.
// The latency in between is the single best quality signal for whether
// the briefing is doing its job. Surface on the weekly outcome card.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record that a founder viewed a briefing card on the dashboard. Called from
 * the dashboard route after the briefing is fetched. Idempotent within a
 * 5-minute window so a tab refresh doesn't double-count.
 *
 * Returns the link id so callers can attribute later actions.
 */
export async function recordBriefingView(
  founderId: string,
  productId: string,
  briefingId: string
): Promise<string> {
  // Dedup: if a link with this (founder, briefing) was viewed in the last
  // 5 minutes and is still pending action, return that id.
  const recent = await query(
    `SELECT id FROM briefing_decision_links
      WHERE founder_id = ? AND briefing_id = ?
        AND decision_acted_at IS NULL
        AND datetime(briefing_viewed_at) > datetime('now', '-5 minutes')
      ORDER BY briefing_viewed_at DESC
      LIMIT 1`,
    [founderId, briefingId]
  );
  if (recent.rows.length > 0) {
    return (recent.rows[0] as Record<string, string>).id;
  }

  const id = nanoid();
  await query(
    `INSERT INTO briefing_decision_links
      (id, founder_id, product_id, briefing_id, briefing_viewed_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [id, founderId, productId, briefingId]
  );
  return id;
}

/**
 * Record that a founder acted on a decision. Attributes the action to the
 * most recent unattributed briefing view by this founder (within the last
 * 60 minutes), if any. If no recent briefing view exists, the action is
 * simply not attributed — that's a valid signal in itself ("the founder
 * acted without reading today's briefing").
 */
export async function recordDecisionActed(
  founderId: string,
  productId: string,
  draftId: string,
  decisionId: string | null,
  outcome: 'approved' | 'rejected'
): Promise<void> {
  // Find the most recent unattributed briefing view from this founder
  // for this product within the trailing 60 minutes.
  const candidate = await query(
    `SELECT id, briefing_viewed_at FROM briefing_decision_links
      WHERE founder_id = ? AND product_id = ?
        AND decision_acted_at IS NULL
        AND datetime(briefing_viewed_at) > datetime('now', '-60 minutes')
      ORDER BY briefing_viewed_at DESC
      LIMIT 1`,
    [founderId, productId]
  );

  if (candidate.rows.length === 0) {
    // No recent view — record an unattributed action so the
    // attribution-rate metric stays honest.
    await query(
      `INSERT INTO briefing_decision_links
         (id, founder_id, product_id, briefing_id, briefing_viewed_at,
          decision_acted_at, latency_ms, draft_id, decision_id, outcome)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, ?, ?, ?)`,
      [nanoid(), founderId, productId, '__unattributed__', draftId, decisionId, outcome]
    );
    return;
  }

  const row = candidate.rows[0] as Record<string, string>;
  const viewedAtIso = row.briefing_viewed_at;
  const viewedAtMs = new Date(viewedAtIso.replace(' ', 'T') + 'Z').getTime();
  const latencyMs = Math.max(0, Date.now() - viewedAtMs);

  await query(
    `UPDATE briefing_decision_links
        SET draft_id = ?, decision_id = ?, outcome = ?,
            decision_acted_at = datetime('now'),
            latency_ms = ?
      WHERE id = ?`,
    [draftId, decisionId, outcome, latencyMs, row.id]
  );
}

// ─── Aggregates for the weekly outcome card ──────────────────────────────────

export interface BriefingOutcome {
  decisions_actioned_after_briefing_7d: number;
  decisions_actioned_unattributed_7d: number;
  median_latency_ms_7d: number | null;
  fast_actions_7d: number;            // < 5 minutes from view to action
}

/**
 * Compute the trailing-7d briefing outcome metrics. Cheap (one indexed read).
 */
export async function getBriefingOutcome(productId: string): Promise<BriefingOutcome> {
  const result = await query(
    `SELECT
       SUM(CASE WHEN briefing_id != '__unattributed__' AND decision_acted_at IS NOT NULL
                THEN 1 ELSE 0 END) AS attr_actions,
       SUM(CASE WHEN briefing_id  = '__unattributed__'
                THEN 1 ELSE 0 END) AS unattr_actions,
       SUM(CASE WHEN latency_ms IS NOT NULL AND latency_ms < 5 * 60 * 1000
                THEN 1 ELSE 0 END) AS fast_actions
       FROM briefing_decision_links
      WHERE product_id = ?
        AND datetime(created_at) > datetime('now', '-7 days')`,
    [productId]
  );
  const row = result.rows[0] as Record<string, number | null>;

  // Median computed in a separate pass — small enough to fetch all latencies.
  const latencies = await query(
    `SELECT latency_ms FROM briefing_decision_links
      WHERE product_id = ?
        AND latency_ms IS NOT NULL
        AND datetime(created_at) > datetime('now', '-7 days')
      ORDER BY latency_ms ASC`,
    [productId]
  );
  const arr = latencies.rows
    .map((r) => Number((r as Record<string, unknown>).latency_ms))
    .filter((n) => Number.isFinite(n));
  const median = arr.length === 0
    ? null
    : arr.length % 2 === 1
      ? arr[Math.floor(arr.length / 2)]
      : Math.round((arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);

  return {
    decisions_actioned_after_briefing_7d: Number(row.attr_actions ?? 0),
    decisions_actioned_unattributed_7d: Number(row.unattr_actions ?? 0),
    median_latency_ms_7d: median,
    fast_actions_7d: Number(row.fast_actions ?? 0),
  };
}
