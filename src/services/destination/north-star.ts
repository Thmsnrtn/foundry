// =============================================================================
// FOUNDRY — North Star Service (V3.1 Layer A)
// Per-product 12-month destination. CRUD + gap-to-target computation.
// =============================================================================

import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NorthStar {
  product_id: string;
  arr_target_dollars: number | null;
  paying_accounts_target: number | null;
  nrr_floor_pct: number | null;
  target_date: string | null;            // 'YYYY-MM-DD'
  destination_summary: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertNorthStarInput {
  arr_target_dollars?: number | null;
  paying_accounts_target?: number | null;
  nrr_floor_pct?: number | null;
  target_date?: string | null;
  destination_summary?: string | null;
}

export interface NorthStarGap {
  arr_current_dollars: number | null;
  arr_target_dollars: number | null;
  arr_progress_pct: number | null;        // 0-100
  paying_accounts_current: number | null;
  paying_accounts_target: number | null;
  paying_accounts_progress_pct: number | null;
  nrr_current_pct: number | null;
  nrr_floor_pct: number | null;
  days_to_target: number | null;          // negative = past target_date
  on_track: boolean | null;               // null when insufficient data
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToNorthStar(r: Record<string, unknown>): NorthStar {
  return {
    product_id: r.product_id as string,
    arr_target_dollars: (r.arr_target_dollars as number | null) ?? null,
    paying_accounts_target: (r.paying_accounts_target as number | null) ?? null,
    nrr_floor_pct: (r.nrr_floor_pct as number | null) ?? null,
    target_date: (r.target_date as string | null) ?? null,
    destination_summary: (r.destination_summary as string | null) ?? null,
    last_reviewed_at: (r.last_reviewed_at as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getNorthStar(productId: string): Promise<NorthStar | null> {
  const result = await query(
    'SELECT * FROM north_stars WHERE product_id = ?',
    [productId]
  );
  if (result.rows.length === 0) return null;
  return rowToNorthStar(result.rows[0] as Record<string, unknown>);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function upsertNorthStar(
  productId: string,
  input: UpsertNorthStarInput
): Promise<NorthStar> {
  const existing = await getNorthStar(productId);

  if (!existing) {
    await query(
      `INSERT INTO north_stars
         (product_id, arr_target_dollars, paying_accounts_target,
          nrr_floor_pct, target_date, destination_summary)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        productId,
        input.arr_target_dollars ?? null,
        input.paying_accounts_target ?? null,
        input.nrr_floor_pct ?? null,
        input.target_date ?? null,
        input.destination_summary ?? null,
      ]
    );
  } else {
    // Build dynamic SET clause so callers can update individual fields.
    // Distinguishes "field omitted" (keep existing) from "field = null"
    // (explicit clear) using property presence on input.
    const sets: string[] = [];
    const args: unknown[] = [];
    const fields: Array<keyof UpsertNorthStarInput> = [
      'arr_target_dollars',
      'paying_accounts_target',
      'nrr_floor_pct',
      'target_date',
      'destination_summary',
    ];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(input, f)) {
        sets.push(`${f} = ?`);
        args.push(input[f] ?? null);
      }
    }
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      args.push(productId);
      await query(
        `UPDATE north_stars SET ${sets.join(', ')} WHERE product_id = ?`,
        args
      );
    }
  }

  const updated = await getNorthStar(productId);
  if (!updated) throw new Error(`failed to upsert north_star for ${productId}`);
  return updated;
}

export async function markReviewed(productId: string): Promise<void> {
  await query(
    `UPDATE north_stars
     SET last_reviewed_at = datetime('now'), updated_at = datetime('now')
     WHERE product_id = ?`,
    [productId]
  );
}

export async function deleteNorthStar(productId: string): Promise<void> {
  await query('DELETE FROM north_stars WHERE product_id = ?', [productId]);
}

// ─── Gap Computation ──────────────────────────────────────────────────────────

/**
 * Compute current-vs-target gap for the product's North Star.
 * Pulls current MRR and paying-account count from the customers table
 * (the canonical source: customers.mrr_cents). NRR is sourced from the most
 * recent metric_snapshots row when present.
 *
 * Returns null if no North Star is set.
 */
export async function computeGap(productId: string): Promise<NorthStarGap | null> {
  const ns = await getNorthStar(productId);
  if (!ns) return null;

  // Aggregate current customer state — canonical source for MRR + paying count
  const customerStats = await query(
    `SELECT
       COALESCE(SUM(mrr_cents), 0) AS total_mrr_cents,
       COUNT(CASE WHEN mrr_cents > 0 THEN 1 END) AS paying_count
     FROM customers WHERE product_id = ?`,
    [productId]
  );
  const statsRow = customerStats.rows[0] as Record<string, unknown> | undefined;
  const totalMrrCents = Number(statsRow?.total_mrr_cents ?? 0);
  const payingCurrent = Number(statsRow?.paying_count ?? 0);
  const arrCurrent = (totalMrrCents / 100) * 12;

  // NRR not directly computable here; fall back to most recent metric_snapshots
  const metricsRes = await query(
    `SELECT * FROM metric_snapshots
     WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId]
  );
  const metric = metricsRes.rows[0] as Record<string, unknown> | undefined;
  const nrrCurrent = pickNumber(metric, ['nrr_pct', 'net_revenue_retention_pct']);

  const arrProgress = pctProgress(arrCurrent, ns.arr_target_dollars);
  const payingProgress = pctProgress(payingCurrent, ns.paying_accounts_target);

  const daysToTarget = ns.target_date ? daysUntil(ns.target_date) : null;

  // On-track when ARR progress >= elapsed-time progress (10pt grace).
  // Conservative null when insufficient data.
  let onTrack: boolean | null = null;
  if (daysToTarget !== null && arrProgress !== null && ns.created_at && ns.target_date) {
    const totalDays = daysBetween(ns.created_at.slice(0, 10), ns.target_date);
    if (totalDays !== null && totalDays > 0) {
      const elapsedPct = ((totalDays - daysToTarget) / totalDays) * 100;
      onTrack = arrProgress >= elapsedPct - 10;
    }
  }

  return {
    arr_current_dollars: arrCurrent,
    arr_target_dollars: ns.arr_target_dollars,
    arr_progress_pct: arrProgress,
    paying_accounts_current: payingCurrent,
    paying_accounts_target: ns.paying_accounts_target,
    paying_accounts_progress_pct: payingProgress,
    nrr_current_pct: nrrCurrent,
    nrr_floor_pct: ns.nrr_floor_pct,
    days_to_target: daysToTarget,
    on_track: onTrack,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickNumber(
  row: Record<string, unknown> | undefined,
  keys: string[]
): number | null {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

function pctProgress(current: number | null, target: number | null): number | null {
  if (current == null || target == null || target <= 0) return null;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

function daysUntil(targetDate: string): number {
  const target = Date.parse(targetDate);
  if (Number.isNaN(target)) return 0;
  const now = Date.now();
  return Math.floor((target - now) / (1000 * 60 * 60 * 24));
}

function daysBetween(startDate: string, endDate: string): number | null {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}
