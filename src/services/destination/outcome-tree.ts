// =============================================================================
// FOUNDRY — Outcome Tree Service (V3.1 Layer A)
// Tree of branches decomposing a product's North Star into measurable outcomes.
// Sage's rule: every branch MUST have a kill_criterion. Branches without one
// become wishlists; we forbid that at the schema and service layer.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OutcomeBranchStatus = 'active' | 'killed' | 'achieved' | 'superseded';

export interface OutcomeBranch {
  id: string;
  product_id: string;
  parent_branch_id: string | null;
  label: string;
  metric_key: string | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  kill_criterion: string;
  status: OutcomeBranchStatus;
  killed_at: string | null;
  killed_reason: string | null;
  achieved_at: string | null;
  generated_at: string;
  weekly_refresh_run_id: string | null;
}

export interface AddBranchInput {
  parent_branch_id?: string | null;
  label: string;
  metric_key?: string | null;
  current_value?: number | null;
  target_value?: number | null;
  unit?: string | null;
  kill_criterion: string;          // required by Sage's rule
  weekly_refresh_run_id?: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToBranch(r: Record<string, unknown>): OutcomeBranch {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    parent_branch_id: (r.parent_branch_id as string | null) ?? null,
    label: r.label as string,
    metric_key: (r.metric_key as string | null) ?? null,
    current_value: (r.current_value as number | null) ?? null,
    target_value: (r.target_value as number | null) ?? null,
    unit: (r.unit as string | null) ?? null,
    kill_criterion: r.kill_criterion as string,
    status: (r.status as OutcomeBranchStatus) ?? 'active',
    killed_at: (r.killed_at as string | null) ?? null,
    killed_reason: (r.killed_reason as string | null) ?? null,
    achieved_at: (r.achieved_at as string | null) ?? null,
    generated_at: r.generated_at as string,
    weekly_refresh_run_id: (r.weekly_refresh_run_id as string | null) ?? null,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getActiveTree(productId: string): Promise<OutcomeBranch[]> {
  const result = await query(
    `SELECT * FROM outcome_trees
     WHERE product_id = ? AND status = 'active'
     ORDER BY parent_branch_id NULLS FIRST, generated_at ASC`,
    [productId]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToBranch);
}

export async function getBranch(branchId: string): Promise<OutcomeBranch | null> {
  const result = await query(
    'SELECT * FROM outcome_trees WHERE id = ?',
    [branchId]
  );
  if (result.rows.length === 0) return null;
  return rowToBranch(result.rows[0] as Record<string, unknown>);
}

export async function getRootBranches(productId: string): Promise<OutcomeBranch[]> {
  const result = await query(
    `SELECT * FROM outcome_trees
     WHERE product_id = ? AND parent_branch_id IS NULL AND status = 'active'
     ORDER BY generated_at ASC`,
    [productId]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToBranch);
}

export async function getChildren(parentBranchId: string): Promise<OutcomeBranch[]> {
  const result = await query(
    `SELECT * FROM outcome_trees
     WHERE parent_branch_id = ? AND status = 'active'
     ORDER BY generated_at ASC`,
    [parentBranchId]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToBranch);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Add a branch to the outcome tree. Enforces Sage's rule: kill_criterion
 * must be a non-empty string. Throws if absent or empty.
 */
export async function addBranch(
  productId: string,
  input: AddBranchInput
): Promise<OutcomeBranch> {
  const kc = input.kill_criterion?.trim() ?? '';
  if (kc.length === 0) {
    throw new Error(
      'kill_criterion is required for every outcome branch (Sage\'s rule). ' +
      'Branches without a clear kill criterion become wishlists.'
    );
  }

  // If parent specified, verify it exists and belongs to same product
  if (input.parent_branch_id) {
    const parent = await getBranch(input.parent_branch_id);
    if (!parent) {
      throw new Error(`parent branch ${input.parent_branch_id} not found`);
    }
    if (parent.product_id !== productId) {
      throw new Error(
        `parent branch ${input.parent_branch_id} belongs to a different product`
      );
    }
  }

  const id = nanoid();
  await query(
    `INSERT INTO outcome_trees
       (id, product_id, parent_branch_id, label, metric_key,
        current_value, target_value, unit, kill_criterion,
        weekly_refresh_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      input.parent_branch_id ?? null,
      input.label,
      input.metric_key ?? null,
      input.current_value ?? null,
      input.target_value ?? null,
      input.unit ?? null,
      kc,
      input.weekly_refresh_run_id ?? null,
    ]
  );

  const created = await getBranch(id);
  if (!created) throw new Error(`failed to insert branch ${id}`);
  return created;
}

export async function killBranch(
  branchId: string,
  reason: string
): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    throw new Error('killed_reason is required when killing an outcome branch');
  }
  await query(
    `UPDATE outcome_trees
     SET status = 'killed', killed_at = datetime('now'), killed_reason = ?
     WHERE id = ? AND status = 'active'`,
    [reason, branchId]
  );
}

export async function achieveBranch(branchId: string): Promise<void> {
  await query(
    `UPDATE outcome_trees
     SET status = 'achieved', achieved_at = datetime('now')
     WHERE id = ? AND status = 'active'`,
    [branchId]
  );
}

export async function updateCurrentValue(
  branchId: string,
  currentValue: number
): Promise<void> {
  await query(
    `UPDATE outcome_trees SET current_value = ? WHERE id = ?`,
    [currentValue, branchId]
  );
}

/**
 * Mark all currently-active branches for a product as superseded.
 * Used by the weekly refresh job before generating a new tree.
 */
export async function supersedePriorTree(
  productId: string,
  newRunId: string
): Promise<number> {
  const result = await query(
    `UPDATE outcome_trees
     SET status = 'superseded'
     WHERE product_id = ? AND status = 'active'
       AND (weekly_refresh_run_id IS NULL OR weekly_refresh_run_id != ?)`,
    [productId, newRunId]
  );
  return result.rowsAffected ?? 0;
}

// ─── Health Helpers ───────────────────────────────────────────────────────────

export interface TreeHealth {
  total_active: number;
  killed_30d: number;
  achieved_30d: number;
  branches_without_metric: number;          // branches where metric_key is null
  branches_without_target: number;          // branches where target_value is null
  oldest_active_branch_age_days: number | null;
}

export async function getTreeHealth(productId: string): Promise<TreeHealth> {
  const active = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
     WHERE product_id = ? AND status = 'active'`,
    [productId]
  );
  const killed = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
     WHERE product_id = ? AND status = 'killed'
       AND killed_at >= datetime('now', '-30 days')`,
    [productId]
  );
  const achieved = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
     WHERE product_id = ? AND status = 'achieved'
       AND achieved_at >= datetime('now', '-30 days')`,
    [productId]
  );
  const noMetric = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
     WHERE product_id = ? AND status = 'active' AND metric_key IS NULL`,
    [productId]
  );
  const noTarget = await query(
    `SELECT COUNT(*) AS c FROM outcome_trees
     WHERE product_id = ? AND status = 'active' AND target_value IS NULL`,
    [productId]
  );
  const oldest = await query(
    `SELECT MIN(generated_at) AS earliest FROM outcome_trees
     WHERE product_id = ? AND status = 'active'`,
    [productId]
  );

  const earliestRow = oldest.rows[0] as Record<string, unknown> | undefined;
  const earliest = earliestRow?.earliest as string | null | undefined;
  let oldestAgeDays: number | null = null;
  if (earliest) {
    const t = Date.parse(earliest);
    if (!Number.isNaN(t)) {
      oldestAgeDays = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
    }
  }

  return {
    total_active: countOf(active),
    killed_30d: countOf(killed),
    achieved_30d: countOf(achieved),
    branches_without_metric: countOf(noMetric),
    branches_without_target: countOf(noTarget),
    oldest_active_branch_age_days: oldestAgeDays,
  };
}

function countOf(rs: { rows: unknown[] }): number {
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  return ((row?.c as number) ?? 0) | 0;
}
