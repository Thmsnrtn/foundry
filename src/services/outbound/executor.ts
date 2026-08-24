// =============================================================================
// FOUNDRY — Outbound Action Executor
// Manages the proposal, approval, and execution of agent outbound actions.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { executeEmailSend } from '../integration/resend.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutboundActionRecord {
  id: string;
  product_id: string;
  agent_name: string;
  integration_name: string;
  action_type: string;
  authority_level: number;
  status: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown> | null;
  preview_text: string | null;
  rationale: string;
  confidence: number;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  feedback_status: string;
  cost_usd: number;
  expires_at: string | null;
  created_at: string;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function rowToAction(row: Record<string, unknown>): OutboundActionRecord {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    agent_name: row.agent_name as string,
    integration_name: row.integration_name as string,
    action_type: row.action_type as string,
    authority_level: (row.authority_level as number) ?? 2,
    status: row.status as string,
    parameters: (() => {
      try { return JSON.parse(row.parameters_json as string || '{}'); } catch { return {}; }
    })(),
    result: (() => {
      try {
        const r = row.result_json as string | null;
        return r ? JSON.parse(r) : null;
      } catch { return null; }
    })(),
    preview_text: row.preview_text as string | null,
    rationale: row.rationale as string,
    confidence: (row.confidence as number) ?? 0.8,
    approved_by: row.approved_by as string | null,
    approved_at: row.approved_at as string | null,
    executed_at: row.executed_at as string | null,
    feedback_status: (row.feedback_status as string) ?? 'pending',
    cost_usd: (row.cost_usd as number) ?? 0.0,
    expires_at: row.expires_at as string | null,
    created_at: row.created_at as string,
  };
}

/**
 * Route execution to the correct integration handler.
 */
async function executeAction(action: OutboundActionRecord): Promise<{ success: boolean; result?: unknown }> {
  switch (action.integration_name) {
    case 'resend': {
      if (action.action_type === 'send_email') {
        const result = await executeEmailSend(action.id);
        return result;
      }
      throw new Error(`Unknown resend action: ${action.action_type}`);
    }

    // Future integrations: linear, github, etc.
    default: {
      // Mark as executed with a log result
      await query(
        `UPDATE outbound_actions SET status = 'executed', result_json = ?,
                executed_at = datetime('now') WHERE id = ?`,
        [
          JSON.stringify({ message: `Action ${action.action_type} on ${action.integration_name} logged — no executor registered yet` }),
          action.id,
        ],
      );
      return { success: true, result: { logged: true } };
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Submit an outbound action proposal from an agent.
 * - authority_level = 0: execute immediately
 * - authority_level = 1: queue with 1-hour notification window
 * - authority_level = 2: queue for CEO approval
 */
export async function proposeAction(params: {
  productId: string;
  agentName: string;
  integrationName: string;
  actionType: string;
  authorityLevel: 0 | 1 | 2;
  parameters: Record<string, unknown>;
  rationale: string;
  previewText: string;
  confidence?: number;
  expiresInHours?: number;
}): Promise<{ action_id: string; status: string }> {
  // Check rate limit first
  const rateCheck = await checkRateLimit(
    params.productId,
    params.agentName,
    params.integrationName,
    params.actionType,
  );

  if (!rateCheck.allowed) {
    throw new Error(`Rate limit exceeded: ${rateCheck.reason}`);
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const expiresInHours = params.expiresInHours ?? (params.authorityLevel === 2 ? 72 : 24);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  // Determine initial status
  let status: string;
  if (params.authorityLevel === 0) {
    status = 'approved'; // Will be executed immediately
  } else {
    status = 'pending_approval';
  }

  await query(
    `INSERT INTO outbound_actions (
      id, product_id, agent_name, integration_name, action_type,
      authority_level, status, parameters_json, preview_text, rationale,
      confidence, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.productId,
      params.agentName,
      params.integrationName,
      params.actionType,
      params.authorityLevel,
      status,
      JSON.stringify(params.parameters),
      params.previewText,
      params.rationale,
      params.confidence ?? 0.8,
      expiresAt,
      now,
    ],
  );

  // Increment rate limit counters
  await incrementRateLimit(
    params.productId,
    params.agentName,
    params.integrationName,
    params.actionType,
  );

  // Authority level 0: execute immediately
  if (params.authorityLevel === 0) {
    const action = await getAction(id);
    if (action) {
      try {
        await executeAction(action);
        return { action_id: id, status: 'executed' };
      } catch (err) {
        await query(
          `UPDATE outbound_actions SET status = 'failed', result_json = ? WHERE id = ?`,
          [JSON.stringify({ error: String(err) }), id],
        );
        return { action_id: id, status: 'failed' };
      }
    }
  }

  // AUTHORITY LEVEL 1 WAITS FOR A PERSON, AND THE RECORD SAYS SO.
  //
  // This used to stamp `approved_by = 'auto'` and `approved_at` ONE HOUR IN THE
  // FUTURE the moment the action was proposed — while `status` stayed
  // 'pending_approval' and no scheduler existed to execute it. Three untruths in
  // four lines: an approval that had not happened, a timestamp for a moment that
  // had not arrived, and a window nothing was counting down.
  //
  // `approved_by = 'auto'` has one meaning in this codebase — see
  // `acting-principal.ts`: an action that reached its notice window without
  // anybody objecting. There was no notice (nothing tells the founder a level-1
  // action is pending except the dashboard they may not open) and no window.
  //
  // So nothing is written here. A level-1 action is pending approval, exactly
  // like a level-2 one, and the difference between them survives in
  // `authority_level` rather than in a claim about what has been authorised.
  //
  // WHETHER FOUNDRY MAY SEND ON A SILENT TIMER IS NOT AN ENGINEERING QUESTION.
  // A working version needs a notice the founder actually receives, a window
  // that is counted, and a sweep that executes — and that is Foundry acting
  // outward, at a customer, because a person did not answer in time. It is with
  // the owner as OWNER_DECISIONS_PENDING §14. It does not come back as a
  // timestamp written in advance.

  return { action_id: id, status };
}

/**
 * Get a single action by ID.
 */
async function getAction(actionId: string): Promise<OutboundActionRecord | null> {
  const result = await query('SELECT * FROM outbound_actions WHERE id = ?', [actionId]);
  if (result.rows.length === 0) return null;
  return rowToAction(result.rows[0] as Record<string, unknown>);
}

/**
 * Get all pending approval actions for a product.
 */
export async function getPendingApprovals(productId: string): Promise<OutboundActionRecord[]> {
  const result = await query(
    `SELECT * FROM outbound_actions
     WHERE product_id = ? AND status = 'pending_approval'
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY created_at DESC`,
    [productId],
  );
  return result.rows.map((r) => rowToAction(r as Record<string, unknown>));
}

/**
 * CEO approves an action — execute it immediately.
 */
export async function approveAction(
  actionId: string,
  /** The person. Not a role: a constant here makes an authorisation merely
   *  attributed rather than attributable, which is the whole point of the
   *  field. Callers resolve it from the authenticated founder. */
  approvedBy: string,
): Promise<{ success: boolean; result?: unknown }> {
  // ONE VOCABULARY, BOTH LEDGERS. Fails closed for the same reason the other
  // door does: a value this does not recognise means the record would not say
  // who authorised the action, and an authorisation nobody can be held to is
  // not an authorisation.
  const { isPrincipalRef } = await import('./acting-principal.js');
  if (!isPrincipalRef(approvedBy)) {
    throw new Error(`approver is not a principal reference: ${approvedBy}`);
  }

  // Mark as approved
  await query(
    `UPDATE outbound_actions SET status = 'approved', approved_by = ?,
            approved_at = datetime('now') WHERE id = ?`,
    [approvedBy, actionId],
  );

  const action = await getAction(actionId);
  if (!action) throw new Error(`Action ${actionId} not found`);

  try {
    const execResult = await executeAction(action);
    return execResult;
  } catch (err) {
    await query(
      `UPDATE outbound_actions SET status = 'failed', result_json = ? WHERE id = ?`,
      [JSON.stringify({ error: String(err) }), actionId],
    );
    throw err;
  }
}

/**
 * A person rejects an action — recorded as a negative feedback signal.
 *
 * WHO DECIDED IS A PERSON, NOT A ROLE, on this side too. This wrote the literal
 * 'ceo' into `approved_by`, so the record of who turned an action down was the
 * same string for every founder of every company — and the reason defaulted to
 * "Rejected by CEO", which attributes a decision to a role nobody holds. The
 * route verifies ownership and then had nothing to hand on.
 */
export async function rejectAction(
  actionId: string, decidedBy: string, reason?: string,
): Promise<void> {
  const { isPrincipalRef } = await import('./acting-principal.js');
  if (!isPrincipalRef(decidedBy)) {
    throw new Error(`decider is not a principal reference: ${decidedBy}`);
  }
  const now = new Date().toISOString();
  await query(
    `UPDATE outbound_actions SET
      status = 'rejected',
      approved_by = ?,
      approved_at = datetime('now'),
      feedback_status = 'negative',
      feedback_data_json = ?
     WHERE id = ?`,
    [decidedBy,
      JSON.stringify({ reason: reason ?? 'Rejected without a stated reason', rejected_at: now }),
      actionId],
  );
}

/**
 * Check and enforce rate limits for an agent+integration+action combo.
 */
export async function checkRateLimit(
  productId: string,
  agentName: string,
  integrationName: string,
  actionType: string,
): Promise<{ allowed: boolean; reason?: string; retry_after?: number }> {
  const result = await query(
    `SELECT * FROM outbound_rate_limits
     WHERE product_id = ? AND agent_name = ? AND integration_name = ? AND action_type = ?`,
    [productId, agentName, integrationName, actionType],
  );

  if (result.rows.length === 0) {
    // No rate limit record — allow (will be created on first action)
    return { allowed: true };
  }

  const row = result.rows[0] as Record<string, unknown>;
  const now = new Date();

  // Check hour reset
  const hourResetAt = row.hour_reset_at ? new Date(row.hour_reset_at as string) : null;
  const hourExpired = !hourResetAt || now > hourResetAt;
  const currentHourCount = hourExpired ? 0 : ((row.current_hour_count as number) ?? 0);

  // Check day reset
  const dayResetAt = row.day_reset_at ? new Date(row.day_reset_at as string) : null;
  const dayExpired = !dayResetAt || now > dayResetAt;
  const currentDayCount = dayExpired ? 0 : ((row.current_day_count as number) ?? 0);

  const maxPerHour = (row.max_per_hour as number) ?? 10;
  const maxPerDay = (row.max_per_day as number) ?? 50;

  if (currentHourCount >= maxPerHour) {
    const retryAfter = hourResetAt ? Math.ceil((hourResetAt.getTime() - now.getTime()) / 1000) : 3600;
    return {
      allowed: false,
      reason: `Hour limit of ${maxPerHour} reached for ${agentName}/${integrationName}/${actionType}`,
      retry_after: retryAfter,
    };
  }

  if (currentDayCount >= maxPerDay) {
    const retryAfter = dayResetAt ? Math.ceil((dayResetAt.getTime() - now.getTime()) / 1000) : 86400;
    return {
      allowed: false,
      reason: `Day limit of ${maxPerDay} reached for ${agentName}/${integrationName}/${actionType}`,
      retry_after: retryAfter,
    };
  }

  return { allowed: true };
}

/**
 * Increment rate limit counters after an action is proposed.
 */
async function incrementRateLimit(
  productId: string,
  agentName: string,
  integrationName: string,
  actionType: string,
): Promise<void> {
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Try to update existing record
  const existing = await query(
    `SELECT id, current_hour_count, current_day_count, hour_reset_at, day_reset_at
     FROM outbound_rate_limits
     WHERE product_id = ? AND agent_name = ? AND integration_name = ? AND action_type = ?`,
    [productId, agentName, integrationName, actionType],
  );

  if (existing.rows.length === 0) {
    // Create new rate limit record
    await query(
      `INSERT INTO outbound_rate_limits (
        id, product_id, agent_name, integration_name, action_type,
        current_hour_count, current_day_count, hour_reset_at, day_reset_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [nanoid(), productId, agentName, integrationName, actionType, nextHour.toISOString(), nextDay.toISOString()],
    );
    return;
  }

  const row = existing.rows[0] as Record<string, unknown>;
  const hourResetAt = row.hour_reset_at ? new Date(row.hour_reset_at as string) : null;
  const dayResetAt = row.day_reset_at ? new Date(row.day_reset_at as string) : null;

  const newHourCount = (hourResetAt && now > hourResetAt) ? 1 : ((row.current_hour_count as number) ?? 0) + 1;
  const newDayCount = (dayResetAt && now > dayResetAt) ? 1 : ((row.current_day_count as number) ?? 0) + 1;

  const newHourReset = (hourResetAt && now > hourResetAt) ? nextHour.toISOString() : row.hour_reset_at as string;
  const newDayReset = (dayResetAt && now > dayResetAt) ? nextDay.toISOString() : row.day_reset_at as string;

  await query(
    `UPDATE outbound_rate_limits SET
      current_hour_count = ?,
      current_day_count = ?,
      hour_reset_at = ?,
      day_reset_at = ?
     WHERE id = ?`,
    [newHourCount, newDayCount, newHourReset, newDayReset, row.id as string],
  );
}

/**
 * Get outbound action history for a product.
 */
export async function getActionHistory(
  productId: string,
  limit: number = 50,
): Promise<OutboundActionRecord[]> {
  const result = await query(
    `SELECT * FROM outbound_actions WHERE product_id = ? ORDER BY created_at DESC LIMIT ?`,
    [productId, limit],
  );
  return result.rows.map((r) => rowToAction(r as Record<string, unknown>));
}

/**
 * Get count of pending actions for CEO briefing badge.
 */
export async function getPendingActionsCount(productId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as count FROM outbound_actions
     WHERE product_id = ? AND status = 'pending_approval'
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [productId],
  );
  return ((result.rows[0] as Record<string, unknown>)?.count as number) ?? 0;
}
