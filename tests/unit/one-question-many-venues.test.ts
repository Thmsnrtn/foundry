// =============================================================================
// ONE QUESTION, MANY VENUES.
//
// The owner asked on 29 September 2026 for Foundry's trading research to work
// across every venue at once — Kalshi, Polymarket, and whatever follows. This
// holds the second venue to the same bar as the first, against its real
// response shapes (tests/fixtures/polymarket, read that day):
//   · its market is read as published — Up is YES, the result only once the
//     oracle has resolved it at exactly 1 and 0, and no reference level is
//     invented where the venue publishes none;
//   · its fee is the venue's own, at the rate each market states;
//   · a run observes every venue with a question open, and one venue asking
//     to wait does not blind the other;
//   · a forecast about one venue's market cannot be filed under another's
//     question;
//   · the two venues' prices and results are read side by side, simulated
//     only, never as an instruction.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'mv_owner@example.com';

import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { parseBook, topOfBook } from '../../src/services/capital/book.js';
import { polymarketTakerFee, VENUE_FEES } from '../../src/services/capital/fees.js';
import {
  MarketDataMissing, MarketDataRefused, assertReadable, parsePolymarketEvent, polymarketSlugFor, readPolymarketBook,
  type Fetcher,
} from '../../src/services/capital/public-markets.js';
import {
  CapitalRefused, beginObserving, crossVenueReading, importResolutions, observeOnce, researchVenues,
} from '../../src/services/capital/research.js';

const OWNER = 'mv_owner';
type J = Record<string, unknown>;
const poly = (name: string): J => JSON.parse(readFileSync(`tests/fixtures/polymarket/${name}`, 'utf8'));
const kalshi = (name: string): J => JSON.parse(readFileSync(`tests/fixtures/kalshi/${name}`, 'utf8'));
const UP_TOKEN = '82988826686441142800465279123597517243907811136629368338598438095255190337553';

/** A Polymarket event, moved to the given window and with the given market fields. */
function polyEvent(base: string, slug: string, market: J): J {
  const e = poly(base);
  const m = (e.markets as J[])[0];
  return { ...e, slug, markets: [{ ...m, slug, ...market }] };
}

describe('the second venue, read as published', () => {
  it('an open window: Up is YES, no reference level, the fee as the market states it', () => {
    const w = parsePolymarketEvent(poly('event-active.json'), 'btc-updown-15m-1790649000');
    expect(w.upToken).toBe(UP_TOKEN);
    expect(w.market).toMatchObject({
      ticker: 'btc-updown-15m-1790649000', openTime: '2026-09-29T02:30:00Z', closeTime: '2026-09-29T02:45:00Z',
      floorStrike: null, result: null,
    });
    expect(w.rules).toMatchObject({ seriesTicker: 'btc-up-or-down-15m', feeType: 'crypto_fees_v2', feeMultiplier: 0.07 });
    expect(w.rules.settlementSource).toMatch(/Chainlink BTC\/USD TWAP/);
  });

  it('a result only once the oracle has resolved it, at exactly 1 and 0', () => {
    const slug = 'btc-updown-15m-1790634600';
    expect(parsePolymarketEvent(poly('event-resolved.json'), slug).market.result).toBe('yes');
    expect(parsePolymarketEvent(polyEvent('event-resolved.json', slug, { outcomePrices: '["0", "1"]' }), slug).market.result).toBe('no');
    // Closed but not yet resolved by the oracle, or resolved at anything but 1 and 0: nothing is concluded.
    expect(parsePolymarketEvent(polyEvent('event-resolved.json', slug, { umaResolutionStatus: 'proposed' }), slug).market.result).toBeNull();
    expect(parsePolymarketEvent(polyEvent('event-resolved.json', slug, { outcomePrices: '["0.5", "0.5"]' }), slug).market.result).toBeNull();
    expect(parsePolymarketEvent(polyEvent('event-resolved.json', slug, { closed: false }), slug).market.result).toBeNull();
  });

  it('refuses what it does not know rather than guessing', () => {
    const slug = 'btc-updown-15m-1790649000';
    // Outcomes in the other order would make every YES a NO.
    expect(() => parsePolymarketEvent(polyEvent('event-active.json', slug, { outcomes: '["Down", "Up"]' }), slug)).toThrow(MarketDataMissing);
    expect(() => parsePolymarketEvent(poly('event-active.json'), 'btc-updown-15m-1790650000')).toThrow(MarketDataMissing);
    const two = poly('event-active.json'); two.markets = [...(two.markets as J[]), ...(two.markets as J[])];
    expect(() => parsePolymarketEvent(two, slug)).toThrow(/exactly one market/);
    expect(parsePolymarketEvent(polyEvent('event-active.json', slug, { feeSchedule: { exponent: 2, rate: 0.07, takerOnly: true } }), slug).rules.feeType)
      .toMatch(/does not know/);
  });

  it('its book becomes the same bids-only shape: an Up ask at a is a Down bid at 1 − a', async () => {
    const f: Fetcher = async () => new Response(JSON.stringify(poly('book-up-active.json')), { status: 200 });
    const book = parseBook(await readPolymarketBook(UP_TOKEN, f));
    expect(topOfBook(book)).toMatchObject({ yesBid: 0.38, yesAsk: 0.39 });
    const other: Fetcher = async () => new Response(JSON.stringify({ ...poly('book-up-active.json'), asset_id: '123456789012' }), { status: 200 });
    await expect(readPolymarketBook(UP_TOKEN, other)).rejects.toThrow(/another token/);
    await expect(readPolymarketBook('1 OR 1=1', f)).rejects.toThrow(MarketDataRefused);
  });

  it('names each fifteen-minute window by its start', () => {
    expect(polymarketSlugFor(new Date('2026-09-29T02:37:12Z'))).toBe('btc-updown-15m-1790649000');
    expect(polymarketSlugFor(new Date('2026-09-29T02:30:00Z'))).toBe('btc-updown-15m-1790649000');
    expect(polymarketSlugFor(new Date('2026-09-29T02:29:59Z'))).toBe('btc-updown-15m-1790648100');
  });

  it('reads only the public list and the public book', () => {
    expect(() => assertReadable('https://gamma-api.polymarket.com/events?slug=btc-updown-15m-1790649000')).not.toThrow();
    expect(() => assertReadable(`https://clob.polymarket.com/book?token_id=${UP_TOKEN}`)).not.toThrow();
    expect(() => assertReadable('https://clob.polymarket.com/order')).toThrow(MarketDataRefused);
  });
});

describe('the second venue\'s fee', () => {
  const rule = { feeType: 'crypto_fees_v2', feeMultiplier: 0.07 };
  it('is shares × rate × P × (1 − P), rounded up at the fifth decimal, per level', () => {
    expect(polymarketTakerFee(rule, 10, 0.5)).toBe(0.175);
    expect(polymarketTakerFee(rule, 10, 0.61)).toBe(0.16653);
    expect(polymarketTakerFee(rule, 1, 0.999)).toBe(0.00007);
    expect(polymarketTakerFee(rule, 1, 0.9999)).toBe(0.00001);
    expect(polymarketTakerFee(rule, 0, 0.5)).toBe(0);
    expect(VENUE_FEES.polymarket.forLevels(rule, [{ price: 0.39, size: 7 }, { price: 0.4, size: 3 }])).toBe(0.16698);
  });
  it('is unknown, never zero, when the schedule is not the one this version knows', () => {
    expect(polymarketTakerFee({ feeType: 'quadratic', feeMultiplier: 1 }, 10, 0.5)).toBeNull();
    expect(polymarketTakerFee({ feeType: 'crypto_fees_v2', feeMultiplier: null }, 10, 0.5)).toBeNull();
    expect(polymarketTakerFee(rule, 10, 1)).toBeNull();
    expect(polymarketTakerFee(rule, 2.5, 0.5)).toBeNull();
    // And each venue's rule is refused by the other's formula.
    expect(VENUE_FEES.kalshi.perContract(rule, 0.5)).toBeNull();
    expect(VENUE_FEES.polymarket.perContract({ feeType: 'quadratic', feeMultiplier: 1 }, 0.5)).toBeNull();
  });
});

describe('a run across both venues', () => {
  const now = new Date();
  const slug = polymarketSlugFor(now);
  const open = new Date(now.getTime() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const close = new Date(now.getTime() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const KTICKER = 'KXBTC15M-MV-A';
  const world = { polyWait: false, polyResolved: false, kalshiSettled: false, calls: [] as string[] };
  const fetcher: Fetcher = async (url, init) => {
    world.calls.push(`${String(init.method)} ${url}`);
    const u = new URL(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.hostname === 'gamma-api.polymarket.com') {
      if (world.polyWait) return new Response('slow', { status: 429, headers: { 'retry-after': '20' } });
      return json([world.polyResolved
        ? polyEvent('event-resolved.json', slug, { eventStartTime: open, endDate: close, outcomePrices: '["1", "0"]' })
        : polyEvent('event-active.json', slug, { eventStartTime: open, endDate: close })]);
    }
    if (u.hostname === 'clob.polymarket.com') return json(poly('book-up-active.json'));
    if (u.hostname === 'api.exchange.coinbase.com') {
      return u.pathname.endsWith('/ticker') ? json({ ...kalshi('coinbase-ticker.json'), price: '83504.45' }) : json(kalshi('coinbase-candles-60s.json'));
    }
    const live = { ...(kalshi('market-active.json').market as J), ticker: KTICKER, open_time: open, close_time: close, status: 'active', result: '' };
    if (u.pathname.endsWith('/series/KXBTC15M')) return json(kalshi('series-KXBTC15M.json'));
    if (u.pathname.endsWith('/markets')) return json({ markets: [live], cursor: '' });
    if (u.pathname.endsWith('/orderbook')) return json(kalshi('orderbook-active.json'));
    if (u.pathname.endsWith(`/markets/${KTICKER}`)) {
      return json({ market: world.kalshiSettled ? { ...(kalshi('market-settled.json').market as J), ticker: KTICKER, close_time: close } : live });
    }
    return new Response('unexpected', { status: 500 });
  };

  beforeAll(async () => {
    await runMigrations();
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_mv', 'mv_owner@example.com', 'Owner']);
  });

  it('the venues are a vocabulary, and a question is asked of one of them', async () => {
    expect((await researchVenues()).map((v) => v.venue)).toEqual(['kalshi', 'polymarket']);
    await expect(query(`UPDATE capital_venues SET name = 'x'`)).rejects.toThrow(/constitutional/);
    await expect(beginObserving(OWNER, 'nyse' as never)).rejects.toThrow(CapitalRefused);
    await beginObserving(OWNER, 'kalshi');
    await beginObserving(OWNER, 'polymarket');
    await expect(beginObserving(OWNER, 'polymarket')).rejects.toThrow(/already/);
  });

  it('observes both, sealing the market\'s price on each; the model says why it cannot run where no reference is published', async () => {
    const run = await observeOnce({ now, fetcher });
    const by = Object.fromEntries(run.passes.map((p) => [p.venue, p]));
    expect(by.kalshi).toMatchObject({ observed: KTICKER, forecasts: 2 });
    expect(by.polymarket).toMatchObject({ observed: slug, forecasts: 2, simulatedFills: 0 });
    const snap = (await query(`SELECT floor_strike, best_yes_bid, best_yes_ask, proxy_price FROM capital_market_snapshots WHERE venue = 'polymarket'`)).rows[0];
    expect(snap).toMatchObject({ floor_strike: null, best_yes_bid: 0.38, best_yes_ask: 0.39, proxy_price: null });
    const f = (await query(`SELECT model, p_yes, reason FROM capital_forecasts WHERE market_ticker = ? ORDER BY model`, [slug])).rows as J[];
    expect(f[0]).toMatchObject({ model: 'market_implied_v1', p_yes: 0.385 });
    expect(f[1]).toMatchObject({ model: 'proxy_drift_v1', p_yes: null });
    expect(String(f[1].reason)).toMatch(/does not publish the price at the beginning/);
    expect(world.calls.every((c) => c.startsWith('GET '))).toBe(true);
  });

  it('a forecast about one venue\'s market cannot be filed under another venue\'s question', async () => {
    const kalshiThesis = String(((await query(`SELECT id FROM capital_research_theses WHERE venue = 'kalshi'`)).rows[0] as J).id);
    const polySnap = String(((await query(`SELECT id FROM capital_market_snapshots WHERE venue = 'polymarket'`)).rows[0] as J).id);
    await expect(query(`INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
      VALUES (?,?,?,?,?,'market_implied_v1',0.5,'skip','x')`, [nanoid(), OWNER, kalshiThesis, polySnap, slug])).rejects.toThrow(/another_venue/);
  });

  it('one venue asking to wait does not blind the other', async () => {
    world.polyWait = true;
    const run = await observeOnce({ now, fetcher });
    const by = Object.fromEntries(run.passes.map((p) => [p.venue, p]));
    expect(by.kalshi.because).toBe('already forecast for this window');
    expect(by.polymarket).toMatchObject({ observed: null, forecasts: 0 });
    expect(by.polymarket.because).toMatch(/asked to wait 20s/);
    world.polyWait = false;
  });

  it('imports each venue\'s official result, and reads the two side by side', async () => {
    const later = new Date(now.getTime() + 30 * 60_000);
    expect(await importResolutions({ now: later, fetcher })).toBe(0); // neither settled yet
    world.polyResolved = true; world.kalshiSettled = true;
    expect(await importResolutions({ now: later, fetcher })).toBe(2);
    const r = (await query(`SELECT venue, result FROM capital_resolutions ORDER BY venue`)).rows;
    expect(r).toEqual([{ venue: 'kalshi', result: 'yes' }, { venue: 'polymarket', result: 'yes' }]);
    const x = await crossVenueReading();
    expect(x.windows).toBe(1);
    expect(x.sameMoment).toBe(1);
    expect(x.results).toEqual({ both: 1, agreed: 1 });
    expect(x.priceGap?.pairs).toBe(1);
    expect(x.priceGap!.mean).toBeCloseTo(Math.abs(0.515 - 0.385), 4);
    expect(x.brier?.pairs).toBe(1);
    // Kalshi YES at 0.52 and Polymarket Down at 0.62 cost more than a dollar; Polymarket Up at 0.39 and
    // Kalshi NO at 0.49 cost 0.88 plus both fees — under a dollar, and it would have paid one.
    expect(x.pairsUnderADollar.count).toBe(1);
    expect(x.pairsUnderADollar.resolved).toBe(1);
    expect(x.pairsUnderADollar.bothLegsLost).toBe(0);
    expect(x.pairsUnderADollar.simulatedNet).toBeGreaterThan(0.08);
    expect(x.pairsUnderADollar.simulatedNet).toBeLessThan(0.12);
  });

  it('the owner reads both venues and the comparison, with nothing that looks like money', async () => {
    const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'mv_owner@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
    app.route('/', moneyRoutes);
    const t = (await (await app.request('/foundry/money/research')).text()).replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, '\'').replace(/\s+/g, ' ');
    expect(t).toMatch(/Observing 2 of 2 venues/);
    expect(t).toMatch(/Observing Kalshi's 15-minute Bitcoin contracts/);
    expect(t).toMatch(/Observing Polymarket's 15-minute Bitcoin Up or Down markets/);
    expect(t).toMatch(/The same window, on both venues/);
    expect(t).toMatch(/Did the official results agree 1 of 1 windows/);
    expect(t).toMatch(/simulated, never money/);
    expect(t).toMatch(/The proxy model does not run here/);
    expect(t).toMatch(/Reference level not published by this venue/);
    expect(t).not.toMatch(/\bprofit\b/i);
  });
});
