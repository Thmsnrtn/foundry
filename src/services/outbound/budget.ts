// =============================================================================
// FOUNDRY — Communication Budget (V3.1 Layer C)
// Per-product per-customer-key weekly cap on outbound. Used by the gateway
// to refuse outbound when the cumulative count across agents for a given
// customer-week reaches the cap. Per-customer cap can be overridden via
// setCustomCap; default is 3 messages per week.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetCheck {
  allowed: boolean;
  remaining: number;
  cap: number;
  sent_count: number;
}

const DEFAULT_CAP = 3;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check the budget for (product, customerExtId, week). If under cap,
 * increment sent_count and return allowed=true. If at/over cap, return
 * allowed=false and DO NOT increment.
 */
export async function checkAndIncrement(
  productId: string,
  customerExtId: string,
  weekStart: string
): Promise<BudgetCheck> {
  const existing = await loadRow(productId, customerExtId, weekStart);

  if (!existing) {
    // First message of the week → reserve at count=1.
    try {
      await query(
        `INSERT INTO communication_budgets
           (id, product_id, customer_external_id, week_starting, sent_count, cap, last_sent_at)
         VALUES (?, ?, ?, ?, 1, ?, datetime('now'))`,
        [nanoid(), productId, customerExtId, weekStart, DEFAULT_CAP]
      );
      return { allowed: true, remaining: DEFAULT_CAP - 1, cap: DEFAULT_CAP, sent_count: 1 };
    } catch (err) {
      if (isUniqueConflict(err)) {
        // Race: another caller inserted simultaneously. Re-read and retry path.
        const row = await loadRow(productId, customerExtId, weekStart);
        if (row) return incrementIfRoom(row);
      }
      throw err;
    }
  }

  return incrementIfRoom(existing);
}

/**
 * Override the cap for a specific (product, customerExtId, week). Creates
 * the row at sent_count=0 if absent. Caps below current sent_count are
 * accepted but result in allowed=false from now on (caller's choice).
 */
export async function setCustomCap(
  productId: string,
  customerExtId: string,
  weekStart: string,
  cap: number
): Promise<void> {
  const existing = await loadRow(productId, customerExtId, weekStart);
  if (existing) {
    await query(
      `UPDATE communication_budgets
          SET cap = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [cap, existing.id]
    );
    return;
  }
  await query(
    `INSERT INTO communication_budgets
       (id, product_id, customer_external_id, week_starting, sent_count, cap)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [nanoid(), productId, customerExtId, weekStart, cap]
  );
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface BudgetRow {
  id: string;
  sent_count: number;
  cap: number;
}

async function loadRow(
  productId: string,
  customerExtId: string,
  weekStart: string
): Promise<BudgetRow | null> {
  const result = await query(
    `SELECT id, sent_count, cap FROM communication_budgets
      WHERE product_id = ? AND customer_external_id = ? AND week_starting = ?
      LIMIT 1`,
    [productId, customerExtId, weekStart]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    sent_count: Number(row.sent_count ?? 0),
    cap: Number(row.cap ?? DEFAULT_CAP),
  };
}

async function incrementIfRoom(row: BudgetRow): Promise<BudgetCheck> {
  if (row.sent_count >= row.cap) {
    return {
      allowed: false,
      remaining: 0,
      cap: row.cap,
      sent_count: row.sent_count,
    };
  }
  // Guarded increment: the cap must hold under concurrency, so the WHERE
  // clause re-checks it atomically — a raced call that finds no room left
  // is refused, exactly like the pre-check path above.
  const r = await query(
    `UPDATE communication_budgets
        SET sent_count = sent_count + 1,
            last_sent_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ? AND sent_count < cap`,
    [row.id]
  );
  if ((r.rowsAffected ?? 0) === 0) {
    return {
      allowed: false,
      remaining: 0,
      cap: row.cap,
      sent_count: row.cap,
    };
  }
  const next = row.sent_count + 1;
  return {
    allowed: true,
    remaining: row.cap - next,
    cap: row.cap,
    sent_count: next,
  };
}

function isUniqueConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|unique constraint/i.test(msg);
}
