// =============================================================================
// FOUNDRY — two forecasts, one of them the market's own.
//
// `market_implied_v1` is the baseline the handoff asks for first: the market's
// own price as a probability. It never trades, because by construction it
// sees no edge; any model must beat it to be worth anything.
//
// `proxy_drift_v1` is the legacy Kalshi Genius "Turbo" hypothesis rebuilt on
// the right question. The old code measured distance from a Binance price it
// sampled (or estimated) near the window's open; the contract settles on the
// CF Benchmarks BRTI average in the last minute against the previous window's
// settlement average (`floor_strike`), which the venue publishes. So this
// model measures distance from the OFFICIAL reference level, using a public
// spot price as a PROXY for where BRTI is now, and the same normal-CDF shape:
//
//     P(YES) = Φ( ln(proxy / strike) / (σ₁ₘ × √minutes_remaining) )
//
// It is labelled a proxy everywhere. The basis between the proxy venue and
// BRTI is unknown and is not corrected for; nor is the averaging of the final
// minute. Those are exactly the things the evaluation exists to find out.
//
// SIZING IS NOT KELLY. The legacy sizer passed a payout ratio as "edge" and
// bet 30% of the bankroll at any forecast (reproduced in
// river/capital/legacy-audit/). Here a trade is taken only when the forecast's
// probability of the chosen side, less the executable ask and the fee per
// contract, clears a threshold fixed in advance; the size is a fixed,
// predeclared number of contracts. A zero or negative net edge is a skip.
// =============================================================================

/**
 * Φ(x) through Abramowitz–Stegun 7.1.26 for erf(x/√2). Kalshi Genius
 * (turbo_probability.ts:194-211) built `t` from |x| instead of |x|/√2, which
 * overstates Φ by 2.8–3.7 points for x between 0.25 and 1 — the size of the
 * edges it reported. Corrected here and pinned by a test against exact values.
 */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  if (x > 8) return 1;
  if (x < -8) return 0;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** Sample standard deviation of one-minute log returns; null with fewer than 20 returns. */
export function sigmaOneMinute(closesOldestFirst: number[]): number | null {
  const good = closesOldestFirst.filter((c) => Number.isFinite(c) && c > 0);
  if (good.length < 21) return null;
  const r: number[] = [];
  for (let i = 1; i < good.length; i++) r.push(Math.log(good[i] / good[i - 1]));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v);
}

/** The proxy-drift forecast, or null with the reason it could not be formed. */
export function proxyDriftYes(input: {
  proxyPrice: number | null; strike: number | null; sigma1m: number | null; minutesRemaining: number;
}): { pYes: number } | { pYes: null; because: string } {
  if (input.strike === null || !(input.strike > 0)) return { pYes: null, because: 'the reference level is not published yet' };
  if (input.proxyPrice === null || !(input.proxyPrice > 0)) return { pYes: null, because: 'the proxy price could not be read' };
  if (input.sigma1m === null || !(input.sigma1m > 0)) return { pYes: null, because: 'too little recent proxy history to estimate volatility' };
  if (!(input.minutesRemaining > 0)) return { pYes: null, because: 'the window has closed' };
  const z = Math.log(input.proxyPrice / input.strike) / (input.sigma1m * Math.sqrt(input.minutesRemaining));
  return { pYes: Math.round(normalCdf(z) * 10_000) / 10_000 };
}

/** Fixed before any evaluation, and never tuned on the data it is judged by. */
export const DECISION_RULE = {
  /** Net edge per contract, in dollars, that a side must clear after the fee. */
  minNetEdge: 0.02,
  /** A fixed simulated size. Not Kelly, not a share of any bankroll. */
  contracts: 10,
  /** Too close to the settlement window to act on a proxy. */
  minMinutesRemaining: 3,
  /** Every window is forecast at the same point: once the book has formed. */
  minMinutesElapsed: 4,
} as const;

export interface SideEdge { side: 'yes' | 'no'; pWin: number; ask: number; feePerContract: number; net: number }

/**
 * Which side, if any, clears the rule. `feeFor(price)` is the fee for one
 * contract at that price, or null when unknown — and an unknown fee is a skip.
 */
export function chooseSide(input: {
  pYes: number; yesAsk: number | null; noAsk: number | null; feeFor: (price: number) => number | null;
}): { side: 'yes' | 'no'; edge: SideEdge } | { side: null; because: string } {
  const candidates: SideEdge[] = [];
  const consider = (side: 'yes' | 'no', pWin: number, ask: number | null): string | null => {
    if (ask === null) return `no ${side.toUpperCase()} offer was displayed`;
    const fee = input.feeFor(ask);
    if (fee === null) return 'the fee for this series is not one this version knows';
    candidates.push({ side, pWin, ask, feePerContract: fee, net: Math.round((pWin - ask - fee) * 10_000) / 10_000 });
    return null;
  };
  const why = [consider('yes', input.pYes, input.yesAsk), consider('no', 1 - input.pYes, input.noAsk)].filter(Boolean) as string[];
  const best = candidates.sort((a, b) => b.net - a.net)[0];
  if (!best) return { side: null, because: why.join('; ') || 'nothing to compare' };
  if (best.net < DECISION_RULE.minNetEdge) {
    return { side: null, because: `best net edge ${best.net.toFixed(4)} per contract on ${best.side.toUpperCase()} is below ${DECISION_RULE.minNetEdge.toFixed(2)}` };
  }
  return { side: best.side, edge: best };
}
