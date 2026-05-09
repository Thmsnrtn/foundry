// =============================================================================
// FOUNDRY — Weekly Outcome Metric
// One founder-facing number that says "did Foundry earn its keep this week?"
// Andy Grove: an operating system the user can't measure isn't an operating
// system. This module computes the metric; the dashboard renders it.
// =============================================================================

import { query } from '../../db/client.js';

export interface WeeklyOutcome {
  product_id: string;
  /** Decisions created in the trailing 7 days that required founder review (gate >= 1). */
  surfaced_7d: number;
  /** Decisions the founder explicitly approved or rejected in the trailing 7 days. */
  acted_on_7d: number;
  /** Decisions that aged out without action (loss signal). */
  expired_7d: number;
  /** acted_on_7d / surfaced_7d, rounded to a whole percent. Null when nothing surfaced. */
  percent_acted: number | null;
  /** Sum of executed action_drafts in the trailing 7 days — work the agents did on the founder's behalf. */
  agent_actions_7d: number;
  /** ISO date marking the start of the rolling window. */
  window_start: string;
}

/**
 * Compute the trailing-7d outcome metric for a product. Cheap — five small
 * SELECTs against indexed columns. Safe to call on every dashboard load.
 */
export async function computeWeeklyOutcome(productId: string): Promise<WeeklyOutcome> {
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString();

  const [surfaced, acted, expired, agentActions] = await Promise.all([
    // Decisions surfaced for founder review (gate 0 actions auto-execute and
    // don't surface; gate 1+ decisions land in the queue).
    query(
      `SELECT COUNT(*) AS c FROM decisions
        WHERE product_id = ?
          AND gate >= 1
          AND created_at >= ?`,
      [productId, windowStartIso]
    ),
    // Decisions the founder explicitly acted on. decided_by 'founder' is the
    // canonical value; we also accept null/non-system to be defensive against
    // older data.
    query(
      `SELECT COUNT(*) AS c FROM decisions
        WHERE product_id = ?
          AND decided_at >= ?
          AND status IN ('approved', 'rejected')
          AND (decided_by IS NULL OR decided_by NOT LIKE 'system_%')`,
      [productId, windowStartIso]
    ),
    query(
      `SELECT COUNT(*) AS c FROM decisions
        WHERE product_id = ?
          AND status = 'expired'
          AND created_at >= ?`,
      [productId, windowStartIso]
    ),
    // Action drafts that actually executed (gate 0 auto-execute or
    // founder-approved). Counted from the action_drafts table.
    query(
      `SELECT COUNT(*) AS c FROM action_drafts
        WHERE product_id = ?
          AND status = 'executed'
          AND COALESCE(executed_at, created_at) >= ?`,
      [productId, windowStartIso]
    ),
  ]);

  const surfaced_7d = num(surfaced.rows[0]);
  const acted_on_7d = num(acted.rows[0]);
  const expired_7d = num(expired.rows[0]);
  const agent_actions_7d = num(agentActions.rows[0]);

  const percent_acted =
    surfaced_7d > 0 ? Math.round((acted_on_7d / surfaced_7d) * 100) : null;

  return {
    product_id: productId,
    surfaced_7d,
    acted_on_7d,
    expired_7d,
    percent_acted,
    agent_actions_7d,
    window_start: windowStartIso,
  };
}

function num(row: unknown): number {
  const r = row as Record<string, unknown> | undefined;
  return Number(r?.c ?? 0);
}
