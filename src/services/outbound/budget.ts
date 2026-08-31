// =============================================================================
// FOUNDRY — Communication Budget (V3.1 Layer C)
//
// Per-product per-recipient weekly cap on outbound. The gateway refuses an
// outward effect when the cumulative count across every agent, for one
// recipient in one week, reaches the cap. Default is 3 messages per week,
// overridable per recipient via `setCustomCap`.
//
// A COUNT IS TAKEN AS A HOLD, NOT AS A FACT. `checkAndIncrement` runs BEFORE
// the send — it has to, or the cap cannot hold under concurrency — so what it
// writes is a reservation. It used to be permanent: a provider outage, a
// missing sender of record, a handler that refused before touching the wire,
// all consumed a message from a real person's weekly budget and none of them
// ever gave it back. Three failed attempts and the customer could not be
// contacted again that week, having received nothing. `releaseHold` is the
// other half, and the gateway calls it on every path that does not reach the
// provider.
//
// `last_sent_at` is therefore written by `confirmSend`, after the send
// happened, and not by the hold. A column named for a send that records an
// attempt is the same defect one level down.
// ==============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetCheck {
  allowed: boolean;
  remaining: number;
  cap: number;
  sent_count: number;
}

export const DEFAULT_CAP = 3;

/**
 * The weekly cap for mail addressed to an OPERATOR of the company — the
 * founder who owns the product, or a team member of it.
 *
 * The default cap of 3 exists so Foundry's agents cannot nag a company's
 * CUSTOMER. It was applied to the founder too, because every founder-bound
 * send passes the founder's own address as the recipient key: the daily
 * briefing, the weekly digest, the welcome sequence and the billing account
 * notice all drew on one budget of three. A founder on daily digests was over
 * the cap by Wednesday, and the next thing refused was whatever came next —
 * including "your card was declined and the account will be paused".
 *
 * An operator is not a stranger being marketed to; they are the person running
 * the company, and the mail is their own instrument reporting to them. But an
 * exemption is a hole, and the gateway exists to bound outward effects, so
 * there is still a ceiling: a daily briefing (7), a weekly digest, a welcome
 * sequence and account notices come to roughly ten in a heavy week. Twenty-five
 * leaves ordinary operation untouched and still stops a loop at something a
 * person would notice rather than at seven hundred emails.
 */
export const OPERATOR_WEEKLY_CAP = 25;

/**
 * The budget key for operator mail.
 *
 * Prefixed so an operator's row can never be the same row as a customer's for
 * the same address, and so `communication_budgets` says which kind of ceiling
 * each row is under rather than leaving it to be inferred from the number.
 */
export function operatorBudgetKey(email: string): string {
  return `operator:${email}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Take a hold on the budget for (product, recipient key, week).
 *
 * If under cap, increments and returns allowed=true — the caller now owes
 * either a send or a `releaseHold`. If at or over cap, returns allowed=false
 * and takes nothing.
 */
export async function checkAndIncrement(
  productId: string,
  customerExtId: string,
  weekStart: string,
  cap: number = DEFAULT_CAP
): Promise<BudgetCheck> {
  const existing = await loadRow(productId, customerExtId, weekStart);

  if (!existing) {
    // First message of the week → reserve at count=1.
    try {
      // No `last_sent_at`: nothing has been sent yet. `confirmSend` writes it.
      await query(
        `INSERT INTO communication_budgets
           (id, product_id, customer_external_id, week_starting, sent_count, cap)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [nanoid(), productId, customerExtId, weekStart, cap]
      );
      return { allowed: true, remaining: cap - 1, cap, sent_count: 1 };
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
 * Give back a hold taken by `checkAndIncrement` when the send did not happen.
 *
 * Every gateway path that ends without reaching the provider calls this: no
 * registered handler, a handler that threw, and a handler that refused before
 * touching the wire. A person's weekly allowance is an allowance of MESSAGES
 * THEY RECEIVE, and an attempt that produced nothing is not one of those.
 *
 * Floors at zero and touches nothing when there is no row: a release without a
 * matching hold is a bug in the caller, and inventing a negative count would
 * hide it inside the number the cap is read from.
 */
export async function releaseHold(
  productId: string,
  customerExtId: string,
  weekStart: string
): Promise<void> {
  await query(
    `UPDATE communication_budgets
        SET sent_count = sent_count - 1,
            updated_at = datetime('now')
      WHERE product_id = ? AND customer_external_id = ? AND week_starting = ?
        AND sent_count > 0`,
    [productId, customerExtId, weekStart]
  );
}

/**
 * Record that the send actually happened.
 *
 * The hold is already counted; this only sets `last_sent_at`, which is the one
 * column in the table that is a statement about the world rather than about
 * the budget.
 */
export async function confirmSend(
  productId: string,
  customerExtId: string,
  weekStart: string
): Promise<void> {
  await query(
    `UPDATE communication_budgets
        SET last_sent_at = datetime('now'),
            updated_at = datetime('now')
      WHERE product_id = ? AND customer_external_id = ? AND week_starting = ?`,
    [productId, customerExtId, weekStart]
  );
}

/**
 * What is left for (product, recipient key, week), WITHOUT taking anything.
 *
 * For callers that want to skip expensive work they can already see will be
 * refused. Two department sweeps used `checkAndIncrement` for that, so drafting
 * a proposal a human had not yet approved — and, in one case, drafting one that
 * v1 never sends at all — spent a real customer's weekly allowance. A look is
 * not a send.
 */
export async function remainingFor(
  productId: string,
  customerExtId: string,
  weekStart: string,
  cap: number = DEFAULT_CAP
): Promise<{ remaining: number; cap: number; sent_count: number }> {
  const row = await loadRow(productId, customerExtId, weekStart);
  if (!row) return { remaining: cap, cap, sent_count: 0 };
  return {
    remaining: Math.max(row.cap - row.sent_count, 0),
    cap: row.cap,
    sent_count: row.sent_count,
  };
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
