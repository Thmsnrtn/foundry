// =============================================================================
// FOUNDRY — a company's cash position, stated by the person who has the bank
//           account, or not known
//
// Runway was computed in two places from two different inventions: cash as
// twelve times a burn that was really the AI spend cap, and cash as six times
// revenue. Neither company had ever been asked. Migration 181 has the full
// account of why the first one was worse.
//
// This module is the only way either path may learn a company's cash position,
// and it has exactly one honest answer when nobody has stated one: null.
//
// WHY THERE IS NO DEFAULT HERE, and why a future caller must not add one: a
// default cash balance is a claim about a bank account, and no amount of
// modelling downstream can make it less of a claim. The Monte Carlo over these
// numbers produces a median, a p10-p90 band and a survival probability, and
// statistics applied to an invented input do not report uncertainty — they
// disguise it as measurement.
// =============================================================================

import { query } from '../../db/client.js';

export interface FinancialPosition {
  productId: string;
  cashOnHandCents: number;
  monthlyBurnCents: number;
  /** The date the founder says these were true, not when they typed them. */
  asOfDate: string;
  statedBy: string | null;
  /** How stale the figure is. A reader deserves this next to the runway. */
  daysOld: number;
}

/** A position older than this is still used, and still shown, but the page says
 *  so. Chosen as one quarter: the interval at which a founder who is watching
 *  runway at all would have looked at the bank again. */
export const STALE_AFTER_DAYS = 90;

/**
 * What the company said its cash and burn were, or NULL.
 *
 * Null is a complete answer. Callers must render "not known" and offer the
 * input rather than substituting anything.
 */
export async function getFinancialPosition(
  productId: string, now: Date = new Date(),
): Promise<FinancialPosition | null> {
  const rows = await query(
    `SELECT product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date, stated_by
       FROM company_financial_position WHERE product_id = ?`, [productId]);
  const row = rows.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const asOfDate = String(row.as_of_date);
  const asOfMs = Date.parse(`${asOfDate.slice(0, 10)}T00:00:00Z`);
  const daysOld = Number.isFinite(asOfMs)
    ? Math.max(0, Math.floor((now.getTime() - asOfMs) / 86_400_000)) : 0;

  return {
    productId: String(row.product_id),
    cashOnHandCents: Number(row.cash_on_hand_cents),
    monthlyBurnCents: Number(row.monthly_burn_cents),
    asOfDate,
    statedBy: row.stated_by == null ? null : String(row.stated_by),
    daysOld,
  };
}

export function isStale(position: FinancialPosition): boolean {
  return position.daysOld > STALE_AFTER_DAYS;
}

/**
 * Record what a founder says their cash position is.
 *
 * Dollars in, cents stored — the form takes dollars because that is what a
 * person reads off a bank statement, and every downstream number is in cents.
 * The amount and date rules live in migration 181's triggers rather than here,
 * so a second caller cannot skip them.
 */
export async function stateFinancialPosition(input: {
  productId: string;
  cashOnHandDollars: number;
  monthlyBurnDollars: number;
  asOfDate: string;
  statedBy: string;
}): Promise<void> {
  const cash = Math.round(input.cashOnHandDollars * 100);
  const burn = Math.round(input.monthlyBurnDollars * 100);
  await query(
    `INSERT INTO company_financial_position
       (product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date, stated_by, updated_at)
     VALUES (?,?,?,?,?, datetime('now'))
     ON CONFLICT(product_id) DO UPDATE SET
       cash_on_hand_cents = excluded.cash_on_hand_cents,
       monthly_burn_cents = excluded.monthly_burn_cents,
       as_of_date = excluded.as_of_date,
       stated_by = excluded.stated_by,
       updated_at = datetime('now')`,
    [input.productId, cash, burn, input.asOfDate.slice(0, 10), input.statedBy]);
}
