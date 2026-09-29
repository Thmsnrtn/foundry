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

// ─── Polymarket ──────────────────────────────────────────────────────────────
//
// Polymarket publishes its fee inside each market (`feeType: crypto_fees_v2`,
// `feeSchedule: { exponent 1, rate 0.07, takerOnly true }`, read 29 September
// 2026), and its documentation (docs.polymarket.com/trading/fees, read the
// same day) states a taker pays
//
//     shares × rate × P × (1 − P),  rounded to 5 decimals, at least 0.00001 USDC
//
// and a maker nothing. The rate is taken from the market, never assumed; any
// other schedule shape is unknown here and gives NULL. Rounding is upward at
// the fifth decimal, per level, so the simulation never charges itself less
// than the venue would.

export const POLYMARKET_FEE_VERSION = 'polymarket_crypto_fees_v2_taker@docs_read_2026_09_29';

const ceilTo5 = (x: number): number => Math.ceil(Math.round(x * 1e9) / 1e4) / 1e5;

export function polymarketTakerFee(rule: SeriesFeeRule, shares: number, price: number): number | null {
  if (rule.feeType !== 'crypto_fees_v2' || rule.feeMultiplier === null || !(rule.feeMultiplier >= 0 && rule.feeMultiplier < 1)) return null;
  if (!Number.isInteger(shares) || shares < 0 || !(price > 0 && price < 1)) return null;
  if (shares === 0) return 0;
  const fee = ceilTo5(shares * rule.feeMultiplier * price * (1 - price));
  return fee > 0 && fee < 0.00001 ? 0.00001 : fee;
}

/** The fee rule of each venue research reads, by name and version. */
export interface VenueFees {
  version: string;
  perContract: (rule: SeriesFeeRule, price: number) => number | null;
  forLevels: (rule: SeriesFeeRule, levels: Array<{ price: number; size: number }>) => number | null;
}

export const VENUE_FEES: Record<'kalshi' | 'polymarket', VenueFees> = {
  kalshi: { version: FEE_VERSION, perContract: (r, p) => takerFee(r, 1, p), forLevels: takerFeeForLevels },
  polymarket: {
    version: POLYMARKET_FEE_VERSION,
    perContract: (r, p) => polymarketTakerFee(r, 1, p),
    forLevels: (r, levels) => {
      let total = 0;
      for (const l of levels) {
        const f = polymarketTakerFee(r, l.size, l.price);
        if (f === null) return null;
        total += f;
      }
      return Math.round(total * 1e5) / 1e5;
    },
  },
};
