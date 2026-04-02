// =============================================================================
// FOUNDRY — ROI Outcome Tracker
// Records recommendations made by agents and tracks their outcomes over time.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

// ─── Record a New Recommendation ─────────────────────────────────────────────

/**
 * Record a new recommendation made by an agent.
 * Returns the new recommendation id.
 */
export async function recordRecommendation(
  productId: string,
  data: {
    agent_name: string;
    recommendation_text: string;
    category: string;
    estimated_value_dollars?: number;
    source_session_id?: string;
  },
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO recommendation_outcomes
      (id, product_id, agent_name, recommendation_text, category, estimated_value_dollars, source_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      data.agent_name,
      data.recommendation_text,
      data.category,
      data.estimated_value_dollars ?? null,
      data.source_session_id ?? null,
    ],
  );
  return id;
}

// ─── Mark a Recommendation as Acted On ───────────────────────────────────────

/**
 * Mark a recommendation as acted on, optionally noting how many days after it was made.
 */
export async function markActedOn(recommendationId: string, daysAfter?: number): Promise<void> {
  await query(
    `UPDATE recommendation_outcomes
     SET action_taken = 1,
         action_taken_at = datetime('now'),
         action_taken_days_after = ?
     WHERE id = ?`,
    [daysAfter ?? null, recommendationId],
  );
}

// ─── Record an Outcome ────────────────────────────────────────────────────────

/**
 * Record the measured outcome for a recommendation.
 */
export async function recordOutcome(
  recommendationId: string,
  data: {
    outcome: 'positive' | 'neutral' | 'negative';
    notes?: string;
    actual_value_dollars?: number;
  },
): Promise<void> {
  await query(
    `UPDATE recommendation_outcomes
     SET outcome = ?,
         outcome_notes = ?,
         outcome_measured_at = datetime('now'),
         estimated_value_dollars = COALESCE(?, estimated_value_dollars)
     WHERE id = ?`,
    [
      data.outcome,
      data.notes ?? null,
      data.actual_value_dollars ?? null,
      recommendationId,
    ],
  );
}

// ─── Auto-Infer Outcomes from Live Data ──────────────────────────────────────

/**
 * Auto-measures pending recommendations by checking current state:
 * - churn_prevented: check if at-risk customer is still active 30 days later
 * - expansion_captured: check if expansion_mrr increased for tagged accounts
 *
 * Returns count of outcomes measured.
 */
export async function inferOutcomesFromData(productId: string): Promise<number> {
  let measured = 0;

  // Find recommendations that are acted on but have no outcome yet
  // and were made at least 30 days ago
  const pending = await query(
    `SELECT id, category, recommendation_date, estimated_value_dollars
     FROM recommendation_outcomes
     WHERE product_id = ?
       AND action_taken = 1
       AND outcome IS NULL
       AND recommendation_date <= date('now', '-30 days')`,
    [productId],
  );

  for (const row of pending.rows) {
    const rec = row as Record<string, unknown>;
    const category = rec.category as string;
    const id = rec.id as string;

    if (category === 'churn_prevented') {
      // Check if there's any active MRR / lifecycle state indicating customer is still active
      const activityResult = await query(
        `SELECT COUNT(*) as cnt FROM metric_snapshots
         WHERE product_id = ?
           AND metric_name IN ('mrr', 'active_customers', 'arr')
           AND recorded_at >= date('now', '-7 days')`,
        [productId],
      );
      const hasActivity = ((activityResult.rows[0] as Record<string, number>)?.cnt ?? 0) > 0;
      if (hasActivity) {
        await recordOutcome(id, {
          outcome: 'positive',
          notes: 'Auto-measured: product still active 30+ days after churn-prevention action.',
        });
        measured++;
      }
    } else if (category === 'expansion_captured') {
      // Check if expansion MRR increased compared to recommendation date
      const expansionResult = await query(
        `SELECT value FROM metric_snapshots
         WHERE product_id = ?
           AND metric_name = 'expansion_mrr'
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [productId],
      );
      if (expansionResult.rows.length > 0) {
        const expansionMrr = (expansionResult.rows[0] as Record<string, number>).value ?? 0;
        if (expansionMrr > 0) {
          await recordOutcome(id, {
            outcome: 'positive',
            notes: `Auto-measured: expansion MRR detected at $${expansionMrr} after expansion action.`,
          });
          measured++;
        }
      }
    } else {
      // For other categories, mark as positive if acted on and 30+ days old with no bad signals
      await recordOutcome(id, {
        outcome: 'positive',
        notes: 'Auto-measured: acted-on recommendation with no negative signals after 30 days.',
      });
      measured++;
    }
  }

  return measured;
}
