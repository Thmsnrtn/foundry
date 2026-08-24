// =============================================================================
// FOUNDRY — Execution Playbook Engine
// Standing orders system: evaluate rules on every agent run and auto-execute
// or queue for approval based on playbook configuration.
// =============================================================================

import { nanoid } from 'nanoid';
import { insertAuditLog, query } from '../../../db/client.js';
import { createExecution } from '../actions/executor.js';
import type { ActionPayload, ActionType } from '../actions/executor.js';
import { activeConsent } from '../../autopilot/consent.js';
import { effectiveMode, platformCap } from '../../autopilot/platform-cap.js';
import { getPolicy } from '../../autopilot/policy.js';
import { ensurePolicyVisible } from '../../departments/shared.js';
import { log } from '../../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlaybookCondition {
  metric?: string;       // e.g. 'nps', 'churn_rate', 'mrr'
  operator: 'lt' | 'gt' | 'lte' | 'gte' | 'eq';
  value: number;
  filter?: string;       // e.g. 'mrr_gt_500' — which accounts/segments
}

export interface TriggerConfig {
  conditions: PlaybookCondition[];
  logic: 'AND' | 'OR';
}

export interface ExecutionPlaybook {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: TriggerConfig;
  action_type: string;
  action_config: Record<string, unknown>;
  auto_execute: boolean;
  execution_budget_weekly: number | null;
  is_active: boolean;
  last_triggered_at: string | null;
}

// ─── Metric Column Map ────────────────────────────────────────────────────────

const METRIC_COLUMNS: Record<string, string> = {
  nps: 'nps_score',
  nps_score: 'nps_score',
  churn_rate: 'churn_rate',
  mrr: 'new_mrr_cents',
  new_mrr: 'new_mrr_cents',
  active_users: 'active_users',
  signups_7d: 'signups_7d',
  activation_rate: 'activation_rate',
  day_30_retention: 'day_30_retention',
  support_volume_7d: 'support_volume_7d',
  mrr_health_ratio: 'mrr_health_ratio',
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create a new execution playbook. Returns the generated ID.
 */
export async function createExecutionPlaybook(
  productId: string,
  data: Omit<ExecutionPlaybook, 'id' | 'is_active' | 'last_triggered_at'>
): Promise<string> {
  const id = nanoid();
  // The capability this playbook will exercise gets a dial in Controls now,
  // not on first evaluation — a founder who ticked "auto-execute" needs
  // somewhere to grant the autonomy they just asked for.
  await ensurePolicyVisible(productId, playbookCapability(data.action_type));
  await query(
    `INSERT INTO execution_playbooks
       (id, product_id, name, description, trigger_type, trigger_config_json,
        action_type, action_config_json, auto_execute, execution_budget_weekly,
        is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
    [
      id,
      productId,
      data.name,
      data.description ?? null,
      data.trigger_type,
      JSON.stringify(data.trigger_config),
      data.action_type,
      JSON.stringify(data.action_config),
      data.auto_execute ? 1 : 0,
      data.execution_budget_weekly ?? null,
    ]
  );
  return id;
}

/**
 * List all playbooks for a product (active and inactive).
 */
export async function listExecutionPlaybooks(productId: string): Promise<ExecutionPlaybook[]> {
  const result = await query(
    `SELECT * FROM execution_playbooks WHERE product_id=? ORDER BY created_at DESC`,
    [productId]
  );

  return (result.rows as Array<Record<string, unknown>>).map(rowToPlaybook);
}

/**
 * Pause or resume a standing order, within the company the caller was
 * authorized on.
 *
 * THE SCOPE USED TO BE `owner_id = ?`. A standing order is the one thing in
 * the system that keeps sending after everyone has stopped looking at it, and
 * the person most likely to notice it misfiring — a co-founder watching the
 * action queue — could not turn it off. Company membership is canonical
 * through `team_members`; the route asks `can_trigger_actions` and passes
 * the company it asked about, so this scope means "the company the caller was
 * authorized for" rather than "a company the caller owns".
 */
export async function togglePlaybook(
  playbookId: string, active: boolean, scopeProductId: string,
): Promise<void> {
  await query(
    `UPDATE execution_playbooks SET is_active=? WHERE id=? AND product_id=?`,
    [active ? 1 : 0, playbookId, scopeProductId]
  );
}

/**
 * Delete a playbook and its trigger log entries, within the authorized
 * company. A foreign id deletes nothing.
 */
export async function deletePlaybook(
  playbookId: string, scopeProductId: string,
): Promise<void> {
  const found = await query(
    `SELECT id FROM execution_playbooks WHERE id=? AND product_id=?`,
    [playbookId, scopeProductId]
  );
  if (found.rows.length === 0) return;
  await query(`DELETE FROM playbook_trigger_log WHERE playbook_id=?`, [playbookId]);
  await query(`DELETE FROM execution_playbooks WHERE id=?`, [playbookId]);
}

// ─── The autonomy a standing order exercises ─────────────────────────────────
//
// A PLAYBOOK IS AUTONOMY WITH A DIFFERENT NAME. `auto_execute` is a checkbox
// on a form that says "no approval required", and until now it meant exactly
// that: the evaluator created an execution and approved it in the same breath,
// under the approver id `system:playbook`. It reached none of the machinery
// that governs every other autonomous act —
//
//   • the trust ladder (shadow → suggest → act, earned over clean cycles),
//   • the platform cap, the operator-controlled ceiling the clean-hands
//     posture depends on (`outreach: 'suggest'`, `billing/refunds/pricing:
//     'shadow'`),
//   • the consent ledger, whose whole purpose is a recorded, versioned,
//     expiring, revocable acknowledgment before Foundry acts on its own,
//   • the demotion that an anomaly or an undo applies to a category.
//
// `hasActConsent` documents itself as "the gate: no autonomous 'act' without
// this." That was true of the autopilot tick and true of customer success, and
// false here — so revoking consent, or a platform cap holding a capability at
// shadow, or a demotion after a bad outcome, left a standing order sending
// exactly as before. A rule believed by three call sites and unknown to a
// fourth is not a rule.
//
// WHY IT REUSES THE EXISTING CATEGORIES rather than inventing a permission of
// its own: the founder already has one dial for "Foundry may reach my
// customers", and a second dial that could contradict it would be two
// authorization systems for one question. A playbook whose action leaves the
// founder's own tools is outreach, and is governed by the outreach dial and
// the outreach cap. Everything else is the company's own workspace, governed
// by a 'playbooks' dial that appears in Controls the moment a playbook exists.
//
// The consequence is deliberate and worth stating plainly: because the
// platform caps outreach at 'suggest', an auto-executing send_email playbook
// cannot fire on its own today. That is the same rail outreach.ts already
// holds ("'act' mode still queues for founder approval in v1"); the defect was
// that this door did not hold it. Lifting the cap is an operator decision, not
// something a checkbox on a form should decide.
//
// It deliberately does NOT discriminate on the recipient — a send_email
// playbook addressed to the founder is treated as outreach too. The send
// boundary already decides sender-of-record per recipient; doing it a second
// time here, from a template that may interpolate, would be a second answer to
// a question that already has one.

/** The trust-ladder category a playbook with no third-party reach exercises.
 *  Visible in Controls as soon as a playbook exists, so the founder has
 *  somewhere to grant (or withhold) the autonomy. */
export const PLAYBOOK_CATEGORY = 'playbooks';

/** Action types whose effect lands outside the founder's own tools. Anything
 *  not listed here stays inside the workspace the founder connected. Unknown
 *  action types are treated as reaching out — a new integration is not
 *  trusted by virtue of being new. */
const REACHES_THIRD_PARTY = new Set<string>([
  'send_email', 'schedule_call', 'custom_webhook', 'mcp_tool',
]);
const STAYS_INTERNAL = new Set<string>(['post_slack', 'create_ticket', 'update_crm']);

/** Which capability a playbook's action exercises. */
export function playbookCapability(actionType: string): string {
  return STAYS_INTERNAL.has(actionType) ? PLAYBOOK_CATEGORY : 'outreach';
}

export type AutoExecuteVerdict =
  | { allowed: true; capability: string; consentId: string; disclosureVersion: string }
  | { allowed: false; capability: string; reason: string };

/**
 * May this playbook approve its own action? The same three questions the
 * autopilot tick asks, asked here so there is one answer rather than two.
 *
 * A pure read: the list page renders the founder's real ceiling from it, and a
 * page render must not write. Making the dial visible is a separate call, on
 * the paths that already write.
 */
export async function autoExecuteVerdict(
  productId: string, actionType: string,
): Promise<AutoExecuteVerdict> {
  const capability = playbookCapability(actionType);
  const configured = (await getPolicy(productId, capability)).mode;
  const mode = effectiveMode(configured, capability);
  if (mode !== 'act') {
    const ceiling = platformCap(capability);
    return {
      allowed: false, capability,
      reason: ceiling !== 'act' && ceiling !== configured
        ? `the platform holds '${capability}' at '${ceiling}' — a standing order cannot exceed it`
        : `'${capability}' is set to '${mode}', not 'act'`,
    };
  }

  const consent = await activeConsent(productId, capability);
  if (!consent) {
    return {
      allowed: false, capability,
      reason: `no live consent on record for '${capability}' — grant it in Controls`,
    };
  }
  return {
    allowed: true, capability,
    consentId: consent.id, disclosureVersion: consent.disclosure_version,
  };
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate all active playbooks for a product.
 * - Loads latest metric snapshot
 * - For each playbook, checks conditions
 * - Enforces weekly execution budget
 * - If triggered + auto_execute: creates action_execution and immediately marks approved
 * - If triggered + !auto_execute: creates action_execution with status='pending'
 * - Writes to playbook_trigger_log
 *
 * Returns a summary of how many were triggered vs skipped.
 */
export async function evaluatePlaybooksForProduct(
  productId: string
): Promise<{ triggered: number; skipped: number; held: number }> {
  // Load active playbooks
  const playbooksResult = await query(
    `SELECT * FROM execution_playbooks WHERE product_id=? AND is_active=1`,
    [productId]
  );
  const playbooks = (playbooksResult.rows as Array<Record<string, unknown>>).map(rowToPlaybook);

  if (playbooks.length === 0) {
    return { triggered: 0, skipped: 0, held: 0 };
  }

  // Load latest metric snapshot
  const snapshotResult = await query(
    `SELECT * FROM metric_snapshots WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId]
  );
  const snapshot = snapshotResult.rows.length > 0
    ? (snapshotResult.rows[0] as Record<string, unknown>)
    : null;

  let triggered = 0;
  let skipped = 0;
  let held = 0;

  const now = new Date().toISOString();

  for (const playbook of playbooks) {
    // Update last_evaluated_at
    await query(
      `UPDATE execution_playbooks SET last_evaluated_at=? WHERE id=?`,
      [now, playbook.id]
    );

    // Evaluate conditions
    const { conditionsMet, snapshot: conditionSnapshot } = evaluateConditions(
      playbook.trigger_config,
      snapshot
    );

    if (!conditionsMet) {
      await writeLog(playbook.id, productId, 'skipped', conditionSnapshot, null);
      skipped++;
      continue;
    }

    // Check weekly budget
    if (playbook.execution_budget_weekly !== null) {
      // THE BUDGET COUNTED SIX DAYS AND A BIT. `triggered_at` is written as
      // `datetime('now')` — 'YYYY-MM-DD HH:MM:SS' — and this bound was a
      // JavaScript ISO string. Compared as text, a space sorts before 'T', so
      // every trigger recorded on the boundary DATE read as older than the
      // window whatever its clock time. A playbook's weekly execution budget is
      // a control on how often Foundry may act on a company's behalf, and it
      // was systematically undercounting its own executions.
      const countResult = await query(
        `SELECT COUNT(*) as cnt FROM playbook_trigger_log
         WHERE playbook_id=? AND evaluation_result='triggered'
           AND triggered_at > datetime('now', '-7 days')`,
        [playbook.id]
      );
      const count = ((countResult.rows[0] as Record<string, unknown>)?.cnt as number) ?? 0;
      if (count >= playbook.execution_budget_weekly) {
        await writeLog(playbook.id, productId, 'budget_exceeded', conditionSnapshot, null);
        skipped++;
        continue;
      }
    }

    // Build action payload
    const payload = buildActionPayload(playbook);

    // Create execution record
    const executionId = await createExecution(productId, null, payload);

    // If auto_execute, ask whether this company may act on its own before
    // approving anything. A refusal leaves the execution PENDING — the founder
    // still gets the action, in the queue, where a human eye is the thing the
    // refusal was protecting.
    let outcome: TriggerResult = 'triggered';
    if (playbook.auto_execute) {
      // The dial has to exist before a founder can turn it up.
      await ensurePolicyVisible(productId, playbookCapability(playbook.action_type));
      const verdict = await autoExecuteVerdict(productId, playbook.action_type);
      if (verdict.allowed) {
        // We import approveAndExecute lazily to avoid circular dependency concerns
        const { approveAndExecute } = await import('../actions/executor.js');
        await approveAndExecute(executionId, 'system:playbook');
        // The disclosed-agent paper trail, same shape customer success writes:
        // what was done, under which consent, under which disclosure version.
        await insertAuditLog({
          id: nanoid(),
          product_id: productId,
          action_type: 'attribution:playbook',
          gate: 0,
          trigger: `standing order "${playbook.name}" auto-executed`,
          reasoning: `Foundry ran ${playbook.action_type} on the founder's behalf under `
            + `consent ${verdict.consentId} (disclosure ${verdict.disclosureVersion}, `
            + `capability ${verdict.capability})`,
          input_context: JSON.stringify({
            playbook_id: playbook.id, execution_id: executionId,
            consent_id: verdict.consentId, capability: verdict.capability,
          }),
          output: undefined,
          outcome: 'allowed',
        });
      } else {
        outcome = 'held_for_approval';
        await insertAuditLog({
          id: nanoid(),
          product_id: productId,
          action_type: 'attribution:playbook',
          gate: 0,
          trigger: `standing order "${playbook.name}" held for approval`,
          reasoning: `Auto-execute was requested but refused: ${verdict.reason}. `
            + `The action is waiting in the approval queue.`,
          input_context: JSON.stringify({
            playbook_id: playbook.id, execution_id: executionId,
            capability: verdict.capability,
          }),
          output: undefined,
          outcome: 'held',
        });
        log.info('playbook auto-execute withheld', {
          productId, playbookId: playbook.id, reason: verdict.reason,
        });
        held++;
      }
    }

    // Update last_triggered_at on the playbook
    await query(
      `UPDATE execution_playbooks SET last_triggered_at=? WHERE id=?`,
      [now, playbook.id]
    );

    await writeLog(playbook.id, productId, outcome, conditionSnapshot, executionId);
    triggered++;
  }

  return { triggered, skipped, held };
}

// ─── Trigger Log ──────────────────────────────────────────────────────────────

export interface TriggerLogEntry {
  id: string;
  playbook_id: string;
  playbook_name: string;
  product_id: string;
  evaluation_result: string;
  condition_snapshot: Record<string, unknown> | null;
  action_execution_id: string | null;
  triggered_at: string;
}

/**
 * Fetch the most recent trigger log entries for a product.
 */
export async function getTriggerLog(productId: string, limit = 50): Promise<TriggerLogEntry[]> {
  const result = await query(
    `SELECT ptl.*, ep.name as playbook_name
     FROM playbook_trigger_log ptl
     JOIN execution_playbooks ep ON ep.id = ptl.playbook_id
     WHERE ptl.product_id=?
     ORDER BY ptl.triggered_at DESC
     LIMIT ?`,
    [productId, limit]
  );

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    playbook_id: row.playbook_id as string,
    playbook_name: row.playbook_name as string,
    product_id: row.product_id as string,
    evaluation_result: row.evaluation_result as string,
    condition_snapshot: (() => {
      try {
        return row.condition_snapshot_json
          ? JSON.parse(row.condition_snapshot_json as string) as Record<string, unknown>
          : null;
      } catch {
        return null;
      }
    })(),
    action_execution_id: (row.action_execution_id as string) ?? null,
    triggered_at: row.triggered_at as string,
  }));
}

/**
 * Count executions this week per playbook (for budget badge).
 */
export async function getWeeklyExecutionCounts(productId: string): Promise<Record<string, number>> {
  // The badge and the budget must count the same week; see `evaluatePlaybooks`.
  const result = await query(
    `SELECT playbook_id, COUNT(*) as cnt
     FROM playbook_trigger_log
     WHERE product_id=? AND evaluation_result='triggered'
       AND triggered_at > datetime('now', '-7 days')
     GROUP BY playbook_id`,
    [productId]
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows as Array<Record<string, unknown>>) {
    counts[row.playbook_id as string] = row.cnt as number;
  }
  return counts;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function rowToPlaybook(row: Record<string, unknown>): ExecutionPlaybook {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    trigger_type: row.trigger_type as string,
    trigger_config: (() => {
      try {
        return JSON.parse(row.trigger_config_json as string) as TriggerConfig;
      } catch {
        return { conditions: [], logic: 'AND' };
      }
    })(),
    action_type: row.action_type as string,
    action_config: (() => {
      try {
        return JSON.parse(row.action_config_json as string) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    auto_execute: (row.auto_execute as number) === 1,
    execution_budget_weekly: (row.execution_budget_weekly as number) ?? null,
    is_active: (row.is_active as number) === 1,
    last_triggered_at: (row.last_triggered_at as string) ?? null,
  };
}

function evaluateConditions(
  config: TriggerConfig,
  snapshot: Record<string, unknown> | null
): { conditionsMet: boolean; snapshot: Record<string, unknown> } {
  const results: boolean[] = [];
  const snapshotValues: Record<string, unknown> = {};

  for (const cond of config.conditions) {
    if (!cond.metric) {
      results.push(false);
      continue;
    }

    const col = METRIC_COLUMNS[cond.metric] ?? cond.metric;
    const rawValue = snapshot ? (snapshot[col] as number | null) : null;
    snapshotValues[cond.metric] = rawValue;

    if (rawValue === null || rawValue === undefined) {
      results.push(false);
      continue;
    }

    const actual = Number(rawValue);
    let met = false;
    switch (cond.operator) {
      case 'lt':  met = actual < cond.value; break;
      case 'lte': met = actual <= cond.value; break;
      case 'gt':  met = actual > cond.value; break;
      case 'gte': met = actual >= cond.value; break;
      case 'eq':  met = actual === cond.value; break;
    }
    results.push(met);
  }

  if (results.length === 0) {
    return { conditionsMet: false, snapshot: snapshotValues };
  }

  const conditionsMet = config.logic === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);

  return { conditionsMet, snapshot: snapshotValues };
}

function buildActionPayload(playbook: ExecutionPlaybook): ActionPayload {
  const cfg = playbook.action_config;
  return {
    action_type: playbook.action_type as ActionType,
    integration: (cfg.integration as string) ?? playbook.action_type,
    ...cfg,
  } as ActionPayload;
}

/** What an evaluation did. `held_for_approval` is the honest name for a
 *  playbook that triggered while its auto-execute was refused: the action
 *  exists and is waiting, which is neither "triggered and sent" nor "skipped".
 *  The founder reading the log needs to be able to tell those apart. */
export type TriggerResult = 'triggered' | 'skipped' | 'budget_exceeded' | 'held_for_approval';

async function writeLog(
  playbookId: string,
  productId: string,
  result: TriggerResult,
  conditionSnapshot: Record<string, unknown>,
  actionExecutionId: string | null
): Promise<void> {
  await query(
    `INSERT INTO playbook_trigger_log
       (id, playbook_id, product_id, evaluation_result, condition_snapshot_json,
        action_execution_id, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      nanoid(),
      playbookId,
      productId,
      result,
      JSON.stringify(conditionSnapshot),
      actionExecutionId,
    ]
  );
}
