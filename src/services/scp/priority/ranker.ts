// =============================================================================
// FOUNDRY — Priority Ranker ("One Thing" System)
// Builds and serves a ranked list of the single most important action right now.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

export interface PriorityAction {
  id: string;
  title: string;
  description: string | null;
  urgency_score: number;
  impact_score: number;
  priority_score: number;
  source: string;
  action_type: string;
  action_url: string | null;
  deadline_hours: number | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getTopPriorityAction(productId: string): Promise<PriorityAction | null> {
  const result = await query(
    `SELECT id, title, description, urgency_score, impact_score, priority_score,
            source, action_type, action_url, deadline_hours
     FROM priority_actions
     WHERE product_id = ? AND is_active = 1
     ORDER BY priority_score DESC
     LIMIT 1`,
    [productId]
  );

  if (result.rows.length === 0) return null;
  return _rowToAction(result.rows[0] as Record<string, unknown>);
}

export async function getPriorityQueue(
  productId: string,
  limit = 10
): Promise<PriorityAction[]> {
  const result = await query(
    `SELECT id, title, description, urgency_score, impact_score, priority_score,
            source, action_type, action_url, deadline_hours
     FROM priority_actions
     WHERE product_id = ? AND is_active = 1
     ORDER BY priority_score DESC
     LIMIT ?`,
    [productId, limit]
  );

  return (result.rows as Record<string, unknown>[]).map(_rowToAction);
}

export async function rebuildPriorityQueue(productId: string): Promise<number> {
  // Deactivate all existing active actions for this product
  await query(
    `UPDATE priority_actions SET is_active = 0 WHERE product_id = ? AND is_active = 1`,
    [productId]
  );

  const actions: Array<{
    title: string;
    description: string | null;
    urgency_score: number;
    impact_score: number;
    source: string;
    source_id: string | null;
    action_type: string;
    action_url: string | null;
    deadline_hours: number | null;
  }> = [];

  // ── 1. Pending action_executions ─────────────────────────────────────────
  try {
    const pending = await query(
      `SELECT id, action_type, payload_json
       FROM action_executions
       WHERE product_id = ? AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 20`,
      [productId]
    );
    for (const row of pending.rows as Record<string, unknown>[]) {
      actions.push({
        title: `Approve pending action: ${row.action_type as string}`,
        description: 'A proposed agent action is awaiting your approval before it can be executed.',
        urgency_score: 7,
        impact_score: 6,
        source: 'execution_engine',
        source_id: row.id as string,
        action_type: 'decision',
        action_url: `/dashboard/actions/${row.id as string}`,
        deadline_hours: 24,
      });
    }
  } catch {
    // Non-fatal
  }

  // ── 2. Active failure pattern matches with severity='high'/'critical' ────
  try {
    const patterns = await query(
      `SELECT pm.id, pm.failure_pattern_id, fp.pattern_name, fp.severity, fp.description
       FROM pattern_matches pm
       JOIN failure_patterns fp ON fp.id = pm.failure_pattern_id
       WHERE pm.product_id = ? AND pm.resolved_at IS NULL
         AND fp.severity IN ('high', 'critical')
       ORDER BY fp.severity DESC, pm.first_detected_at ASC
       LIMIT 10`,
      [productId]
    );
    for (const row of patterns.rows as Record<string, unknown>[]) {
      const urgency = (row.severity as string) === 'critical' ? 10 : 8;
      actions.push({
        title: `Failure pattern detected: ${row.pattern_name as string}`,
        description: (row.description as string | null) ?? null,
        urgency_score: urgency,
        impact_score: 8,
        source: 'failure_pattern',
        source_id: row.id as string,
        action_type: 'review',
        action_url: `/dashboard/patterns/${row.failure_pattern_id as string}`,
        deadline_hours: (row.severity as string) === 'critical' ? 6 : 24,
      });
    }
  } catch {
    // Non-fatal
  }

  // ── 3. Churn-risk customers from customer_intelligence ───────────────────
  try {
    const churnRisk = await query(
      `SELECT id, account_name, email, mrr_cents, health_score
       FROM customer_intelligence
       WHERE product_id = ? AND stage = 'at_risk'
       ORDER BY mrr_cents DESC, health_score ASC
       LIMIT 10`,
      [productId]
    );
    for (const row of churnRisk.rows as Record<string, unknown>[]) {
      const mrrCents = (row.mrr_cents as number | null) ?? 0;
      const customerName = (row.account_name as string | null) ?? (row.email as string | null) ?? 'Unknown customer';
      const impactScore = Math.min(10, mrrCents / 100); // $1 MRR = 0.01 impact, capped at 10
      actions.push({
        title: `${customerName} is at churn risk`,
        description: `MRR: $${(mrrCents / 100).toFixed(0)}/mo. Health score: ${(row.health_score as number | null)?.toFixed(0) ?? 'N/A'}. Reach out now to understand and address their concerns.`,
        urgency_score: 7,
        impact_score: Math.max(1, impactScore),
        source: 'harbor',
        source_id: row.id as string,
        action_type: 'outreach',
        action_url: `/dashboard/customers/${row.id as string}`,
        deadline_hours: 48,
      });
    }
  } catch {
    // Non-fatal
  }

  // ── 4. Unprocessed signal_events with severity='high' ────────────────────
  try {
    const signals = await query(
      `SELECT id, source, event_type, summary, created_at
       FROM signal_events
       WHERE product_id = ? AND processed = 0 AND severity = 'high'
       ORDER BY created_at ASC
       LIMIT 10`,
      [productId]
    );
    for (const row of signals.rows as Record<string, unknown>[]) {
      actions.push({
        title: `High-severity signal: ${row.summary as string}`,
        description: `Source: ${row.source as string} — ${row.event_type as string}. This signal has not yet been processed by any agent.`,
        urgency_score: 8,
        impact_score: 7,
        source: row.source as string,
        source_id: row.id as string,
        action_type: 'review',
        action_url: `/dashboard/signals`,
        deadline_hours: 12,
      });
    }
  } catch {
    // Non-fatal
  }

  // ── 5. Execution playbooks that triggered today ───────────────────────────
  try {
    const today = new Date().toISOString().slice(0, 10);
    const playbooks = await query(
      `SELECT tl.id, tl.playbook_id, ep.name, tl.triggered_at
       FROM playbook_trigger_log tl
       JOIN execution_playbooks ep ON ep.id = tl.playbook_id
       WHERE ep.product_id = ?
         AND tl.evaluation_result = 'triggered'
         AND date(tl.triggered_at) = ?
         AND tl.action_execution_id IS NULL
       ORDER BY tl.triggered_at ASC
       LIMIT 5`,
      [productId, today]
    );
    for (const row of playbooks.rows as Record<string, unknown>[]) {
      actions.push({
        title: `Playbook triggered: ${row.name as string}`,
        description: 'An execution playbook was triggered today and is awaiting review or approval.',
        urgency_score: 6,
        impact_score: 5,
        source: 'execution_playbook',
        source_id: row.id as string,
        action_type: 'execute',
        action_url: `/dashboard/playbooks/${row.playbook_id as string}`,
        deadline_hours: 24,
      });
    }
  } catch {
    // Non-fatal
  }

  // ── Insert all collected actions ──────────────────────────────────────────
  let inserted = 0;
  for (const action of actions) {
    const priorityScore = action.urgency_score * action.impact_score;
    try {
      await query(
        `INSERT INTO priority_actions
           (id, product_id, title, description, urgency_score, impact_score, priority_score,
            source, source_id, action_type, action_url, deadline_hours, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
        [
          nanoid(),
          productId,
          action.title,
          action.description,
          action.urgency_score,
          action.impact_score,
          priorityScore,
          action.source,
          action.source_id,
          action.action_type,
          action.action_url,
          action.deadline_hours,
        ]
      );
      inserted++;
    } catch {
      // Non-fatal: skip duplicates or constraint failures
    }
  }

  return inserted;
}

export async function dismissAction(actionId: string): Promise<void> {
  await query(
    `UPDATE priority_actions SET is_active = 0, dismissed_at = datetime('now') WHERE id = ?`,
    [actionId]
  );
}

export async function completeAction(actionId: string): Promise<void> {
  await query(
    `UPDATE priority_actions SET is_active = 0, completed_at = datetime('now') WHERE id = ?`,
    [actionId]
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _rowToAction(row: Record<string, unknown>): PriorityAction {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    urgency_score: row.urgency_score as number,
    impact_score: row.impact_score as number,
    priority_score: row.priority_score as number,
    source: row.source as string,
    action_type: row.action_type as string,
    action_url: (row.action_url as string | null) ?? null,
    deadline_hours: (row.deadline_hours as number | null) ?? null,
  };
}
