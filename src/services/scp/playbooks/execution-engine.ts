// =============================================================================
// FOUNDRY — Execution Playbook Engine
// Standing orders system: evaluate rules on every agent run and auto-execute
// or queue for approval based on playbook configuration.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { createExecution } from '../actions/executor.js';
import type { ActionPayload, ActionType } from '../actions/executor.js';

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
 * Toggle a playbook active or inactive.
 */
export async function togglePlaybook(playbookId: string, active: boolean, ownerId: string): Promise<void> {
  await query(
    `UPDATE execution_playbooks SET is_active=?
     WHERE id=? AND product_id IN (SELECT id FROM products WHERE owner_id=?)`,
    [active ? 1 : 0, playbookId, ownerId]
  );
}

/**
 * Delete a playbook and its trigger log entries. Scoped to the owning founder
 * — a foreign id deletes nothing.
 */
export async function deletePlaybook(playbookId: string, ownerId: string): Promise<void> {
  const owned = await query(
    `SELECT id FROM execution_playbooks
     WHERE id=? AND product_id IN (SELECT id FROM products WHERE owner_id=?)`,
    [playbookId, ownerId]
  );
  if (owned.rows.length === 0) return;
  await query(`DELETE FROM playbook_trigger_log WHERE playbook_id=?`, [playbookId]);
  await query(`DELETE FROM execution_playbooks WHERE id=?`, [playbookId]);
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
): Promise<{ triggered: number; skipped: number }> {
  // Load active playbooks
  const playbooksResult = await query(
    `SELECT * FROM execution_playbooks WHERE product_id=? AND is_active=1`,
    [productId]
  );
  const playbooks = (playbooksResult.rows as Array<Record<string, unknown>>).map(rowToPlaybook);

  if (playbooks.length === 0) {
    return { triggered: 0, skipped: 0 };
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
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const countResult = await query(
        `SELECT COUNT(*) as cnt FROM playbook_trigger_log
         WHERE playbook_id=? AND evaluation_result='triggered' AND triggered_at > ?`,
        [playbook.id, weekAgo]
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

    // If auto_execute, immediately approve and run
    if (playbook.auto_execute) {
      // We import approveAndExecute lazily to avoid circular dependency concerns
      const { approveAndExecute } = await import('../actions/executor.js');
      await approveAndExecute(executionId, 'system:playbook');
    }

    // Update last_triggered_at on the playbook
    await query(
      `UPDATE execution_playbooks SET last_triggered_at=? WHERE id=?`,
      [now, playbook.id]
    );

    await writeLog(playbook.id, productId, 'triggered', conditionSnapshot, executionId);
    triggered++;
  }

  return { triggered, skipped };
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
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await query(
    `SELECT playbook_id, COUNT(*) as cnt
     FROM playbook_trigger_log
     WHERE product_id=? AND evaluation_result='triggered' AND triggered_at > ?
     GROUP BY playbook_id`,
    [productId, weekAgo]
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

async function writeLog(
  playbookId: string,
  productId: string,
  result: 'triggered' | 'skipped' | 'budget_exceeded',
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
