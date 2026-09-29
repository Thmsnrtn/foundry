// =============================================================================
// THE MARKET IS READ AS PUBLISHED, AND PRICED BY THE VENUE'S OWN RULE.
//
// Each legacy defect found in kalshi-genius and the legacy Apex Micro trading
// code (docs/foundry-institution/capital/LEGACY_TRADING_AUDIT.md) is pinned
// here as the opposite property of Foundry's research code. The fixtures are
// the venue's real responses, read 29 September 2026 (tests/fixtures/kalshi).
// =============================================================================
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { askLevels, marketImpliedYes, parseBook, simulateTake, topOfBook } from '../../src/services/capital/book.js';
import { ceilToCent, takerFee, takerFeeForLevels } from '../../src/services/capital/fees.js';
import { DECISION_RULE, chooseSide, normalCdf, proxyDriftYes, sigmaOneMinute } from '../../src/services/capital/models.js';
import { parseMarket, parseSeries } from '../../src/services/capital/public-markets.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/kalshi/${name}`, 'utf8'));
const QUAD = { feeType: 'quadratic', feeMultiplier: 1 };

describe('the book, as the venue publishes it', () => {
  it('reads bids only, and derives each ask from the other side', () => {
    const b = parseBook(fixture('orderbook-active.json'));
    const t = topOfBook(b);
    expect(t.yesBid).toBe(0.51);
    expect(t.noBid).toBe(0.48);
    expect(t.yesAsk).toBe(0.52);   // 1 − best NO bid, never a NO level read as a YES ask (legacy Apex adapter)
    expect(t.noAsk).toBe(0.49);
    expect(marketImpliedYes(b)).toBe(0.515);
    expect(askLevels(b, 'yes')[0]).toEqual({ price: 0.52, size: 6500.13 });
  });

  it('an empty book states no price, not 0.5 and not the last trade', () => {
    const b = parseBook(fixture('orderbook-empty-at-close.json'));
    expect(topOfBook(b)).toEqual({ yesBid: null, noBid: null, yesAsk: null, noAsk: null });
    expect(marketImpliedYes(b)).toBeNull();
    expect(simulateTake(b, 'yes', 10).filled).toBe(0);
  });

  it('a simulated take never fills more than was displayed, and only whole contracts', () => {
    const b = parseBook({ orderbook_fp: { yes_dollars: [], no_dollars: [['0.40', '2.5'], ['0.45', '3']] } });
    const t = simulateTake(b, 'yes', 10);
    expect(t.filled).toBe(5);              // 3 at 0.55, then 2 of the 2.5 at 0.60
    expect(t.taken).toEqual([{ price: 0.55, size: 3 }, { price: 0.6, size: 2 }]);
    expect(t.cost).toBe(2.85);
    expect(() => simulateTake(b, 'yes', 0)).toThrow();
  });

  it('a level it cannot read is dropped, never guessed', () => {
    const b = parseBook({ orderbook_fp: { yes_dollars: [['x', '5'], ['0.30', 'NaN'], ['0.31', '4'], ['1.20', '9']], no_dollars: null } });
    expect(b.yesBids).toEqual([{ price: 0.31, size: 4 }]);
    expect(b.noBids).toEqual([]);
  });
});

describe('the contract, as the venue states it', () => {
  it('settles on CF Benchmarks, not on the spot price the legacy bot watched', () => {
    const s = parseSeries(fixture('series-KXBTC15M.json'));
    expect(s.settlementSource).toBe('CF Benchmarks');
    expect(s.settlementNote).toMatch(/60 RTI prices/);
    expect(s.feeType).toBe('quadratic');
    expect(s.feeMultiplier).toBe(1);
  });

  it('a settled market carries its official result, value and rule', () => {
    const m = parseMarket(fixture('market-settled.json'));
    expect(m.result).toBe('yes');
    expect(m.expirationValue).toBe(83495.58);
    expect(m.floorStrike).toBe(83484.34);
    expect(m.rulesPrimary).toMatch(/simple average of the sixty seconds of CF Benchmarks' BRTI/);
  });

  it('an open market has no result, and a record missing its rule is refused', () => {
    expect(parseMarket(fixture('market-active.json')).result).toBeNull();
    expect(() => parseMarket({ market: { ticker: 'X', open_time: 'a', close_time: 'b' } })).toThrow(/rule/);
  });
});

describe('the fee is the venue\'s formula, not a flat percentage', () => {
  it('quadratic in price, rounded up to the cent', () => {
    expect(takerFee(QUAD, 10, 0.5)).toBe(0.18);   // 0.07 × 10 × 0.25 = 0.175
    expect(takerFee(QUAD, 1, 0.5)).toBe(0.02);    // 0.0175
    expect(takerFee(QUAD, 1, 0.99)).toBe(0.01);   // 0.000693
    expect(takerFee(QUAD, 100, 0.1)).toBe(0.63);  // 0.63 exactly, not 0.64
    expect(ceilToCent(0.07)).toBe(0.07);
    expect(takerFee({ feeType: 'quadratic', feeMultiplier: 2 }, 10, 0.5)).toBe(0.35);
  });

  it('an unknown fee rule is unknown, never zero, and the legacy flat rates disagree with it', () => {
    expect(takerFee({ feeType: 'flat', feeMultiplier: 1 }, 10, 0.5)).toBeNull();
    expect(takerFee({ feeType: null, feeMultiplier: null }, 10, 0.5)).toBeNull();
    expect(takerFeeForLevels({ feeType: 'x', feeMultiplier: 1 }, [{ price: 0.5, size: 1 }])).toBeNull();
    // The three legacy paper engines on the same 10 contracts at $0.50 ($5 notional):
    const legacy = [5 * 0.002, 5 * 0.035, 5 * 0.07];
    for (const x of legacy) expect(x).not.toBe(takerFee(QUAD, 10, 0.5));
  });
});

describe('the forecast is the forecast, and a payout ratio is not an edge', () => {
  it('Φ is right: the legacy normal CDF overstated it by up to 3.7 points', () => {
    const exact: Array<[number, number]> = [[0, 0.5], [0.25, 0.598706], [0.5, 0.691462], [1, 0.841345], [2, 0.97725], [-1, 0.158655]];
    for (const [x, v] of exact) expect(Math.abs(normalCdf(x) - v)).toBeLessThan(2e-6);
  });

  it('sizes nothing at a 50-cent price for a 0.50 or 0.53 forecast, and trades only the 0.70 one', () => {
    // The legacy sizer bet $30 of $100 in all three cases (river/capital/legacy-audit/repro-kelly.ts).
    const at = (pYes: number) => chooseSide({ pYes, yesAsk: 0.5, noAsk: 0.51, feeFor: (p) => takerFee(QUAD, 1, p) });
    expect(at(0.5).side).toBeNull();
    const small = at(0.53);
    expect(small.side).toBeNull();
    if (small.side === null) expect(small.because).toMatch(/0\.0100 per contract on YES is below 0\.02/);
    const big = at(0.7);
    expect(big.side).toBe('yes');
    if (big.side) expect(big.edge.net).toBe(0.18);
    expect(DECISION_RULE.contracts).toBe(10);
  });

  it('an unknown fee or an empty side is a skip, with its reason', () => {
    const r = chooseSide({ pYes: 0.9, yesAsk: 0.5, noAsk: null, feeFor: () => null });
    expect(r.side).toBeNull();
    if (r.side === null) expect(r.because).toMatch(/fee/);
  });

  it('the proxy model answers against the official reference, and says why when it cannot', () => {
    expect(proxyDriftYes({ proxyPrice: 100, strike: 100, sigma1m: 0.001, minutesRemaining: 9 })).toEqual({ pYes: 0.5 });
    const up = proxyDriftYes({ proxyPrice: 100.3, strike: 100, sigma1m: 0.001, minutesRemaining: 9 });
    expect('pYes' in up && up.pYes !== null && up.pYes > 0.5).toBe(true);
    expect(proxyDriftYes({ proxyPrice: 100, strike: null, sigma1m: 0.001, minutesRemaining: 9 })).toMatchObject({ pYes: null, because: /reference level/ });
    expect(proxyDriftYes({ proxyPrice: null, strike: 100, sigma1m: 0.001, minutesRemaining: 9 })).toMatchObject({ pYes: null, because: /proxy/ });
    expect(proxyDriftYes({ proxyPrice: 100, strike: 100, sigma1m: null, minutesRemaining: 9 })).toMatchObject({ pYes: null, because: /volatility/ });
  });

  it('compares prices as numbers — the legacy comparison of two objects was false both ways', () => {
    const entry = { price: 100 }; const rose = { price: 101 }; const fell = { price: 99 };
    // What kalshi-genius index.ts:1552-1553 did, reproduced: never "up".
    expect(String(rose > entry)).toBe('false');
    expect(String(fell > entry)).toBe('false');
    // What this code does: numbers only, so direction is direction.
    const a = proxyDriftYes({ proxyPrice: rose.price, strike: entry.price, sigma1m: 0.002, minutesRemaining: 5 });
    const b = proxyDriftYes({ proxyPrice: fell.price, strike: entry.price, sigma1m: 0.002, minutesRemaining: 5 });
    expect((a as { pYes: number }).pYes).toBeGreaterThan(0.5);
    expect((b as { pYes: number }).pYes).toBeLessThan(0.5);
  });

  it('estimates volatility from the proxy\'s real one-minute closes, and refuses too little history', () => {
    const candles = fixture('coinbase-candles-60s.json') as number[][];
    const closes = candles.map((c) => c[4]).reverse();
    const s = sigmaOneMinute(closes);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0);
    expect(s!).toBeLessThan(0.01);
    expect(sigmaOneMinute(closes.slice(0, 10))).toBeNull();
  });
});
