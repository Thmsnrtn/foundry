// =============================================================================
// FOUNDRY — what the venue would charge, by a named and dated rule.
//
// The legacy code charged three different flat rates for the same Kalshi trade
// (0.2%, 3.5% and 7% of notional, in three paper engines) and sized bets
// against a flat 3% "round trip". None is the venue's formula. Kalshi's API
// says the BTC 15-minute series uses a `quadratic` fee with multiplier 1
// (GET /series/KXBTC15M, read 29 September 2026). The coefficient and the
// rounding come from the fee schedule effective 7 July 2026 as the owner's
// handoff of 28 September read it: a taker pays
//
//     round up to the cent ( 0.07 × multiplier × contracts × P × (1 − P) )
//
// kalshi.com refused this environment (HTTP 429), so the coefficient was not
// read here, and the version says whose reading it is. Rounding is applied
// per level taken, which is never less than rounding once per order: the
// simulation errs against itself. Maker fees, settlement fees and any
// series-specific schedule other than `quadratic` are not known to this
// version, and an unknown fee is NULL, never zero.
// =============================================================================

export const FEE_VERSION = 'kalshi_quadratic_taker_2026_07_07@handoff_reading';
const COEFFICIENT = 0.07;

/** The series' fee rule as the venue's API states it. */
export interface SeriesFeeRule { feeType: string | null; feeMultiplier: number | null }

/** Round up to the next cent, without floating-point noise pushing 0.07 to 0.08. */
export function ceilToCent(dollars: number): number {
  return Math.ceil(Math.round(dollars * 1e6) / 1e4) / 100;
}

/**
 * The taker fee for `contracts` at `price`, or null when the series' fee rule
 * is not the one this version knows. Never zero by default.
 */
export function takerFee(rule: SeriesFeeRule, contracts: number, price: number): number | null {
  if (rule.feeType !== 'quadratic' || rule.feeMultiplier === null || !Number.isFinite(rule.feeMultiplier)) return null;
  if (!Number.isInteger(contracts) || contracts < 0 || !(price > 0 && price < 1)) return null;
  if (contracts === 0) return 0;
  return ceilToCent(COEFFICIENT * rule.feeMultiplier * contracts * price * (1 - price));
}

/** The fee over several levels taken in one simulated order, rounded per level; null if any is unknown. */
export function takerFeeForLevels(rule: SeriesFeeRule, levels: Array<{ price: number; size: number }>): number | null {
  let total = 0;
  for (const l of levels) {
    const f = takerFee(rule, l.size, l.price);
    if (f === null) return null;
    total += f;
  }
  return Math.round(total * 100) / 100;
}
