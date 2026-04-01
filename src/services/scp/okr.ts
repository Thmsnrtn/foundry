// =============================================================================
// FOUNDRY — OKR Tracking Service
// Manages Objectives and Key Results per product per quarter.
// Based on migration 028 (company_okrs, key_results, okr_progress_updates tables).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OKR {
  id: string;
  product_id: string;
  objective: string;
  owner_agent: string; // which agent owns this OKR
  quarter: string; // e.g. '2026-Q2'
  status: 'draft' | 'active' | 'achieved' | 'missed' | 'cancelled';
  overall_progress: number; // 0-1
  created_at: string;
}

export interface KeyResult {
  id: string;
  okr_id: string;
  title: string;
  metric: string;
  baseline_value: number;
  target_value: number;
  current_value: number;
  unit: string;
  progress: number; // 0-1
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Map our status values to DB CHECK constraint values
// DB: 'on_track'|'at_risk'|'off_track'|'completed'|'cancelled'
function toDbStatus(status: string): string {
  const map: Record<string, string> = {
    draft: 'on_track',
    active: 'on_track',
    achieved: 'completed',
    missed: 'off_track',
    cancelled: 'cancelled',
  };
  return map[status] ?? 'on_track';
}

function fromDbStatus(dbStatus: string): OKR['status'] {
  const map: Record<string, OKR['status']> = {
    on_track: 'active',
    at_risk: 'active',
    off_track: 'missed',
    completed: 'achieved',
    cancelled: 'cancelled',
  };
  return map[dbStatus] ?? 'active';
}

function rowToOKR(r: Record<string, unknown>): OKR {
  const progressPct = (r.progress_pct as number) ?? 0;
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    objective: r.objective_text as string,
    owner_agent: (r.objective_owner as string) ?? 'founder',
    quarter: r.period as string,
    status: fromDbStatus(r.status as string),
    overall_progress: progressPct / 100,
    created_at: r.created_at as string,
  };
}

function rowToKeyResult(r: Record<string, unknown>): KeyResult {
  const startValue = (r.start_value as number) ?? 0;
  const targetValue = (r.target_value as number) ?? 1;
  const currentValue = (r.current_value as number) ?? startValue;
  const range = targetValue - startValue;
  const progress = range !== 0 ? Math.max(0, Math.min(1, (currentValue - startValue) / range)) : 0;

  return {
    id: r.id as string,
    okr_id: r.okr_id as string,
    title: r.description as string,
    metric: (r.metric_name as string) ?? '',
    baseline_value: startValue,
    target_value: targetValue,
    current_value: currentValue,
    unit: (r.unit as string) ?? '',
    progress,
  };
}

// ─── createOKR ────────────────────────────────────────────────────────────────

export async function createOKR(
  productId: string,
  okr: {
    objective: string;
    owner_agent: string;
    quarter: string;
    key_results: Array<{
      title: string;
      metric: string;
      baseline_value: number;
      target_value: number;
      unit: string;
    }>;
  }
): Promise<string> {
  const okrId = nanoid();

  await query(
    `INSERT INTO company_okrs (id, product_id, period, objective_text, objective_owner, status)
     VALUES (?, ?, ?, ?, ?, 'on_track')`,
    [okrId, productId, okr.quarter, okr.objective, okr.owner_agent]
  );

  for (const kr of okr.key_results) {
    await query(
      `INSERT INTO key_results
         (id, okr_id, description, metric_name, start_value, target_value, current_value, unit, owner_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        okrId,
        kr.title,
        kr.metric,
        kr.baseline_value,
        kr.target_value,
        kr.baseline_value, // starts at baseline
        kr.unit,
        okr.owner_agent,
      ]
    );
  }

  return okrId;
}

// ─── updateKeyResult ──────────────────────────────────────────────────────────

export async function updateKeyResult(
  keyResultId: string,
  currentValue: number,
  note?: string
): Promise<void> {
  // Get previous value
  const prevResult = await query(
    `SELECT current_value, okr_id FROM key_results WHERE id = ?`,
    [keyResultId]
  );
  if (prevResult.rows.length === 0) return;

  const prevRow = prevResult.rows[0] as Record<string, unknown>;
  const previousValue = prevRow.current_value as number;
  const okrId = prevRow.okr_id as string;

  // Update current_value on key_result
  await query(
    `UPDATE key_results
     SET current_value = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [currentValue, keyResultId]
  );

  // Record progress update
  await query(
    `INSERT INTO okr_progress_updates
       (id, key_result_id, previous_value, new_value, source, note)
     VALUES (?, ?, ?, ?, 'agent_session', ?)`,
    [nanoid(), keyResultId, previousValue, currentValue, note ?? null]
  );

  // Recalculate OKR overall progress from all key results
  const krsResult = await query(
    `SELECT start_value, target_value, current_value FROM key_results WHERE okr_id = ?`,
    [okrId]
  );

  let totalProgress = 0;
  const krRows = krsResult.rows as Record<string, unknown>[];
  for (const kr of krRows) {
    const start = (kr.start_value as number) ?? 0;
    const target = (kr.target_value as number) ?? 1;
    const current = (kr.current_value as number) ?? start;
    const range = target - start;
    const p = range !== 0 ? Math.max(0, Math.min(1, (current - start) / range)) : 0;
    totalProgress += p;
  }

  const avgProgress = krRows.length > 0 ? totalProgress / krRows.length : 0;
  const progressPct = Math.round(avgProgress * 100);

  await query(
    `UPDATE company_okrs SET progress_pct = ?, updated_at = datetime('now') WHERE id = ?`,
    [progressPct, okrId]
  );
}

// ─── getActiveOKRs ────────────────────────────────────────────────────────────

export async function getActiveOKRs(
  productId: string
): Promise<Array<OKR & { key_results: KeyResult[] }>> {
  const okrsResult = await query(
    `SELECT * FROM company_okrs
     WHERE product_id = ? AND status NOT IN ('cancelled', 'completed')
     ORDER BY created_at DESC`,
    [productId]
  );

  const result: Array<OKR & { key_results: KeyResult[] }> = [];

  for (const okrRow of okrsResult.rows) {
    const okr = rowToOKR(okrRow as Record<string, unknown>);

    const krsResult = await query(
      `SELECT * FROM key_results WHERE okr_id = ? ORDER BY created_at ASC`,
      [okr.id]
    );

    const key_results = krsResult.rows.map((r) => rowToKeyResult(r as Record<string, unknown>));
    result.push({ ...okr, key_results });
  }

  return result;
}

// ─── getOKRProgress ───────────────────────────────────────────────────────────

export async function getOKRProgress(
  productId: string,
  quarter?: string
): Promise<{ achieved: number; total: number; progress: number }> {
  let sql = `SELECT status, progress_pct FROM company_okrs WHERE product_id = ?`;
  const args: unknown[] = [productId];

  if (quarter) {
    sql += ' AND period = ?';
    args.push(quarter);
  }

  const result = await query(sql, args);

  let total = 0;
  let achieved = 0;
  let sumProgress = 0;

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    total++;
    const status = r.status as string;
    if (status === 'completed') achieved++;
    sumProgress += (r.progress_pct as number) ?? 0;
  }

  const progress = total > 0 ? sumProgress / total / 100 : 0;
  return { achieved, total, progress };
}

// ─── archiveCompletedOKRs ─────────────────────────────────────────────────────

export async function archiveCompletedOKRs(productId: string): Promise<void> {
  // Mark OKRs as completed where all key results have reached or exceeded target
  const okrsResult = await query(
    `SELECT id FROM company_okrs
     WHERE product_id = ? AND status = 'on_track'`,
    [productId]
  );

  for (const okrRow of okrsResult.rows) {
    const okrId = ((okrRow as Record<string, unknown>).id as string);

    const krsResult = await query(
      `SELECT start_value, target_value, current_value FROM key_results WHERE okr_id = ?`,
      [okrId]
    );

    const krs = krsResult.rows as Record<string, unknown>[];
    if (krs.length === 0) continue;

    const allAchieved = krs.every((kr) => {
      const target = (kr.target_value as number) ?? 1;
      const current = (kr.current_value as number) ?? 0;
      return current >= target;
    });

    if (allAchieved) {
      await query(
        `UPDATE company_okrs SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
        [okrId]
      );
    }
  }
}
