// =============================================================================
// RESEARCH IS SEALED BEFORE THE ANSWER, AND SCORED ONLY BY THE OFFICIAL ONE.
//
// The closed loop the owner's handoff of 29 September asks for, against the
// venue's real response shapes: the rules archived, a point-in-time snapshot,
// two forecasts sealed before the window closes, a simulated fill that says
// so, the official result imported from the venue, and an evaluation whose
// strongest verdict still grants nothing.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);

import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  CapitalRefused, activeMarket, beginObserving, capitalResearchReading, evaluateThesis, importResolutions,
  observeOnce, stopObserving, type ObservationPass,
} from '../../src/services/capital/research.js';
import { evaluate, evaluationDigest, EVALUATION_RULE, type ResolvedForecast } from '../../src/services/capital/evaluation.js';
import { MarketAskedToWait, type Fetcher, parseMarket } from '../../src/services/capital/public-markets.js';

const OWNER = 'cap_owner';
const OTHER = 'cap_other';
const fx = (name: string): Record<string, unknown> => JSON.parse(readFileSync(`tests/fixtures/kalshi/${name}`, 'utf8'));
const iso = (msFromNow: number): string => new Date(Date.now() + msFromNow).toISOString();

/** The active market fixture, moved so that its window is open now. */
function liveMarket(ticker: string, openMs: number, closeMs: number): Record<string, unknown> {
  const m = { ...(fx('market-active.json').market as Record<string, unknown>) };
  return { ...m, ticker, open_time: iso(openMs), close_time: iso(closeMs), status: 'active', result: '' };
}

interface World { markets: Record<string, unknown>[]; settled: Record<string, Record<string, unknown>>; historical: Record<string, Record<string, unknown>>; proxyDown?: boolean; wait?: boolean; calls: string[] }
const fetcherFor = (w: World): Fetcher => async (url, init) => {
  w.calls.push(`${String(init.method)} ${url}`);
  const u = new URL(url);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (w.wait) return new Response('slow down', { status: 429, headers: { 'retry-after': '30' } });
  if (u.pathname.endsWith('/series/KXBTC15M')) return json(fx('series-KXBTC15M.json'));
  if (u.pathname.endsWith('/markets')) return json({ markets: w.markets, cursor: '' });
  if (u.pathname.endsWith('/orderbook')) return json(fx('orderbook-active.json'));
  const hist = /\/historical\/markets\/(.+)$/.exec(u.pathname);
  if (hist) return w.historical[hist[1]] ? json({ market: w.historical[hist[1]] }) : json({ error: 'not found' }, 404);
  const one = /\/markets\/([^/]+)$/.exec(u.pathname);
  if (one) {
    if (w.settled[one[1]]) return json({ market: w.settled[one[1]] });
    const live = w.markets.find((m) => m.ticker === one[1]);
    return live ? json({ market: live }) : json({ error: 'not found' }, 404);
  }
  if (u.hostname === 'api.exchange.coinbase.com') {
    if (w.proxyDown) return new Response('down', { status: 503 });
    if (u.pathname.endsWith('/ticker')) return json({ ...fx('coinbase-ticker.json'), price: '83504.45' });
    return json(fx('coinbase-candles-60s.json'));
  }
  return new Response('unexpected', { status: 500 });
};

/** One run, and the Kalshi venue's part of it. */
const kalshiPass = async (f: Fetcher): Promise<ObservationPass> => {
  const run = await observeOnce({ fetcher: f });
  const p = run.passes.find((x) => x.venue === 'kalshi');
  if (!p) throw new Error(`no Kalshi pass: ${run.because}`);
  return p;
};

beforeAll(async () => {
  await runMigrations();
  for (const id of [OWNER, OTHER]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clerk_${id}`, `${id}@example.com`, 'Owner']);
  }
});

describe('the owner\'s question', () => {
  it('is begun by him, once, and cannot become anything but stopped', async () => {
    const id = await beginObserving(OWNER);
    await expect(beginObserving(OWNER)).rejects.toThrow(CapitalRefused);
    await expect(query(`UPDATE capital_research_theses SET hypothesis = 'trade it' WHERE id = ?`, [id])).rejects.toThrow(/said_is_said/);
    // check-vocabulary:expected-refusal — no thesis can become 'live' by changing a word.
    await expect(query(`UPDATE capital_research_theses SET status = 'live' WHERE id = ?`, [id])).rejects.toThrow();
    await expect(query(`INSERT INTO capital_research_theses (id, founder_id, venue, series_ticker, hypothesis, falsifier, alternative_use, begun_by)
      VALUES ('x', ?, 'kalshi', 'KXBTC15M', 'h', 'f', 'a', 'institution:auto')`, [OTHER])).rejects.toThrow();
  });
});

describe('one pass of observation', () => {
  const w: World = { markets: [], settled: {}, historical: {}, calls: [] };
  const TICKER = 'KXBTC15M-TEST-A';

  it('archives the rule, snapshots the open window, and seals both forecasts before it closes', async () => {
    w.markets = [liveMarket(TICKER, -5 * 60_000, 10 * 60_000), liveMarket('KXBTC15M-TEST-NEXT', 10 * 60_000, 25 * 60_000)];
    const r = await kalshiPass(fetcherFor(w));
    expect(r.observed).toBe(TICKER);
    expect(r.forecasts).toBe(2);
    const rule = (await query(`SELECT settlement_source, fee_type FROM capital_contract_rules`)).rows[0] as Record<string, unknown>;
    expect(rule).toMatchObject({ settlement_source: 'CF Benchmarks', fee_type: 'quadratic' });
    const snap = (await query(`SELECT best_yes_bid, best_yes_ask, proxy_source, floor_strike FROM capital_market_snapshots`)).rows[0] as Record<string, unknown>;
    expect(snap).toMatchObject({ best_yes_bid: 0.51, best_yes_ask: 0.52, proxy_source: 'coinbase BTC-USD spot (proxy)' });
    const f = (await query(`SELECT model, p_yes, decision, reason FROM capital_forecasts ORDER BY model`)).rows as Array<Record<string, unknown>>;
    expect(f[0]).toMatchObject({ model: 'market_implied_v1', p_yes: 0.515, decision: 'skip' });
    expect(f[1].model).toBe('proxy_drift_v1');
    expect(Number(f[1].p_yes)).toBeGreaterThan(0);
    expect(w.calls.every((c) => c.startsWith('GET '))).toBe(true);
    expect(w.calls.some((c) => c.includes('/portfolio'))).toBe(false);
  });

  it('never forecasts the same window twice', async () => {
    const r = await kalshiPass(fetcherFor(w));
    expect(r.forecasts).toBe(0);
    expect(Number(((await query(`SELECT COUNT(*) AS n FROM capital_forecasts`)).rows[0] as Record<string, unknown>).n)).toBe(2);
  });

  it('a forecast cannot be edited, and cannot be written after the window closes or once the answer is known', async () => {
    await expect(query(`UPDATE capital_forecasts SET p_yes = 0.99`)).rejects.toThrow(/sealed/);
    const snap = String(((await query(`SELECT id FROM capital_market_snapshots LIMIT 1`)).rows[0] as Record<string, unknown>).id);
    const thesis = String(((await query(`SELECT id FROM capital_research_theses WHERE founder_id = ?`, [OWNER])).rows[0] as Record<string, unknown>).id);
    // A closed window: a snapshot whose close has passed.
    const closedSnap = nanoid();
    await query(`INSERT INTO capital_market_snapshots (id, venue, series_ticker, market_ticker, rule_id, open_time, close_time, rules_primary_digest,
      received_at, yes_book_json, no_book_json) SELECT ?, venue, series_ticker, 'KXBTC15M-TEST-CLOSED', rule_id, ?, ?, rules_primary_digest, ?, '[]', '[]'
      FROM capital_market_snapshots WHERE id = ?`, [closedSnap, iso(-20 * 60_000), iso(-5 * 60_000), iso(-10 * 60_000), snap]);
    await expect(query(`INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
      VALUES (?,?,?,?,'KXBTC15M-TEST-CLOSED','proxy_drift_v1',0.8,'yes','late')`, [nanoid(), OWNER, thesis, closedSnap])).rejects.toThrow(/the_market_has_closed/);
    // A known answer, even with the window still open.
    await query(`INSERT INTO capital_resolutions (market_ticker, venue, result, rules_primary, rules_primary_digest) VALUES ('KXBTC15M-TEST-B','kalshi','yes','r','d')`);
    const openSnap = nanoid();
    await query(`INSERT INTO capital_market_snapshots (id, venue, series_ticker, market_ticker, rule_id, open_time, close_time, rules_primary_digest,
      received_at, yes_book_json, no_book_json) SELECT ?, venue, series_ticker, 'KXBTC15M-TEST-B', rule_id, ?, ?, rules_primary_digest, ?, '[]', '[]'
      FROM capital_market_snapshots WHERE id = ?`, [openSnap, iso(-60_000), iso(14 * 60_000), iso(-30_000), snap]);
    await expect(query(`INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
      VALUES (?,?,?,?,'KXBTC15M-TEST-B','proxy_drift_v1',0.8,'yes','after')`, [nanoid(), OWNER, thesis, openSnap])).rejects.toThrow(/the_answer_is_already_known/);
  });

  it('a paper fill can only ever be simulated', async () => {
    const f = String(((await query(`SELECT id FROM capital_forecasts WHERE model = 'market_implied_v1' LIMIT 1`)).rows[0] as Record<string, unknown>).id);
    await expect(query(`INSERT INTO capital_paper_fills (id, founder_id, forecast_id, side, contracts_requested, contracts_filled, cost_dollars, fee_dollars, fee_version, provenance)
      VALUES (?,?,?,'yes',10,10,5,0.18,'v','venue_observed')`, [nanoid(), OWNER, f])).rejects.toThrow();
  });

  it('imports the official result only once the venue shows one, falling back to the historical record', async () => {
    const shift = (m: Record<string, unknown>): Record<string, unknown> => ({ ...m, close_time: iso(-60 * 60_000) });
    // Move the observed window into the past by recording its close as passed.
    expect(await importResolutions({ fetcher: fetcherFor(w), now: new Date(Date.now() + 30 * 60_000) })).toBe(0); // not settled yet
    w.historical[TICKER] = { ...shift(fx('market-settled.json').market as Record<string, unknown>), ticker: TICKER };
    expect(await importResolutions({ fetcher: fetcherFor({ ...w, markets: [] }), now: new Date(Date.now() + 30 * 60_000) })).toBe(1);
    const r = (await query(`SELECT result, expiration_value, floor_strike FROM capital_resolutions WHERE market_ticker = ?`, [TICKER])).rows[0];
    expect(r).toMatchObject({ result: 'yes', expiration_value: 83495.58, floor_strike: 83484.34 });
    await expect(query(`UPDATE capital_resolutions SET result = 'no' WHERE market_ticker = ?`, [TICKER])).rejects.toThrow(/immutable/);
  });

  it('when the venue asks Foundry to wait, it writes nothing and concludes nothing', async () => {
    const before = Number(((await query(`SELECT COUNT(*) AS n FROM capital_market_snapshots`)).rows[0] as Record<string, unknown>).n);
    // The pass says so, in its own words, and the run carries on for any other venue.
    const r = await kalshiPass(fetcherFor({ ...w, wait: true, calls: [] }));
    expect(r.observed).toBeNull();
    expect(r.because).toMatch(/asked to wait 30s; nothing concluded/);
    expect(new MarketAskedToWait(30).waitSeconds).toBe(30);
    expect(Number(((await query(`SELECT COUNT(*) AS n FROM capital_market_snapshots`)).rows[0] as Record<string, unknown>).n)).toBe(before);
  });

  it('a proxy that cannot be read makes the model skip, with its reason, and the baseline still stands', async () => {
    const w2: World = { markets: [liveMarket('KXBTC15M-TEST-C', -5 * 60_000, 10 * 60_000)], settled: {}, historical: {}, proxyDown: true, calls: [] };
    const r = await kalshiPass(fetcherFor(w2));
    expect(r.forecasts).toBe(2);
    const f = (await query(`SELECT model, p_yes, decision, reason FROM capital_forecasts WHERE market_ticker = 'KXBTC15M-TEST-C' ORDER BY model`)).rows as Array<Record<string, unknown>>;
    expect(f[0]).toMatchObject({ model: 'market_implied_v1', p_yes: 0.515 });
    expect(f[1]).toMatchObject({ model: 'proxy_drift_v1', p_yes: null, decision: 'skip' });
    expect(String(f[1].reason)).toMatch(/proxy price could not be read/);
  });

  it('too near the close, it does not forecast at all', async () => {
    const w3: World = { markets: [liveMarket('KXBTC15M-TEST-D', -13 * 60_000, 2 * 60_000)], settled: {}, historical: {}, calls: [] };
    const r = await kalshiPass(fetcherFor(w3));
    expect(r.observed).toBeNull();
    expect(r.because).toMatch(/fewer than 3/);
  });

  it('forecasts every window at the same point: not before the book has formed', async () => {
    const w5: World = { markets: [liveMarket('KXBTC15M-TEST-EARLY', -60_000, 14 * 60_000)], settled: {}, historical: {}, calls: [] };
    const r = await kalshiPass(fetcherFor(w5));
    expect(r.observed).toBeNull();
    expect(r.because).toMatch(/fewer than 4/);
  });

  it('picks the one open window, and none when two claim to be open', () => {
    const now = new Date();
    const a = parseMarket(liveMarket('A', -60_000, 60_000)); const b = parseMarket(liveMarket('B', 60_000, 120_000));
    expect(activeMarket([a, b], now)?.ticker).toBe('A');
    expect(activeMarket([a, { ...a, ticker: 'A2' }], now)).toBeNull();
  });

  it('the owner reads it, and a stopped question stops being observed', async () => {
    const read = await capitalResearchReading(OWNER);
    expect(read.thesis?.status).toBe('observing');
    expect(read.counts.resolved).toBe(1);
    expect(read.rules?.settlementSource).toBe('CF Benchmarks');
    const e = await evaluateThesis(read.thesis!.id);
    expect(e.verdict).toBe('insufficient_evidence');
    expect((await capitalResearchReading(OWNER)).evaluation?.verdict).toBe('insufficient_evidence');
    // Scored once a day, not on every pass.
    const { evaluateDue } = await import('../../src/services/capital/research.js');
    expect(await evaluateDue()).toBe(0);
    await query(`DELETE FROM capital_evaluations`);
    expect(await evaluateDue()).toBe(1);
    expect(await evaluateDue()).toBe(0);
    await expect(stopObserving(OWNER, '  ')).rejects.toThrow(/why/);
    expect(await stopObserving(OWNER, 'enough for now')).toBe(true);
    const w4: World = { markets: [liveMarket('KXBTC15M-TEST-E', -5 * 60_000, 10 * 60_000)], settled: {}, historical: {}, calls: [] };
    expect((await observeOnce({ fetcher: fetcherFor(w4) })).because).toBe('nobody is observing');
    await expect(query(`UPDATE capital_research_theses SET status = 'observing' WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/stopped_is_final/);
  });
});

describe('the evaluation, and the strongest thing it may say', () => {
  const rows = (n: number, modelP: (i: number) => number, marketP: (i: number) => number, won: (i: number) => boolean,
    fill?: (i: number) => ResolvedForecast['fill']): ResolvedForecast[] =>
    Array.from({ length: n }, (_, i) => {
      const t = `M${String(i).padStart(4, '0')}`; const close = new Date(Date.UTC(2026, 8, 1) + i * 900_000).toISOString();
      const result = won(i) ? 'yes' as const : 'no' as const;
      return [
        { marketTicker: t, closeTime: close, model: 'market_implied_v1' as const, pYes: marketP(i), decision: 'skip' as const, result, ruleUnchanged: true, fill: null },
        { marketTicker: t, closeTime: close, model: 'proxy_drift_v1' as const, pYes: modelP(i), decision: fill?.(i) ? fill(i)!.side : 'skip' as const, result, ruleUnchanged: true, fill: fill?.(i) ?? null },
      ];
    }).flat();

  it('scores the model by its own probability and the market by its own, never one for the other', () => {
    const e = evaluate(rows(1, () => 0.7, () => 0.5, () => true));
    expect(e.brier.model).toBe(0.09);
    expect(e.brier.market).toBe(0.25);
  });

  it('a forecast without a probability is excluded and counted, never scored as the price', () => {
    const r = rows(3, () => 0.6, () => 0.5, () => true).map((x, i) => (i === 1 ? { ...x, pYes: null } : x));
    const e = evaluate(r);
    expect(e.excluded.noModelProbability).toBe(1);
    expect(e.brier.pairs).toBe(2);
  });

  it('says nothing before 200 resolved markets', () => {
    expect(evaluate(rows(EVALUATION_RULE.minResolvedMarkets - 1, () => 0.9, () => 0.5, () => true)).verdict).toBe('insufficient_evidence');
  });

  it('says "do not trade" when the model is no better than the market', () => {
    const e = evaluate(rows(240, (i) => (i % 2 ? 0.6 : 0.4), () => 0.5, (i) => i % 3 === 0));
    expect(e.verdict).toBe('market_is_better');
    expect(e.sentence).toMatch(/Do not trade it/);
  });

  it('says "no net edge" when it forecasts better but fees and an adverse cent take the money', () => {
    const won = (i: number) => i % 10 < 6;
    const e = evaluate(rows(240, (i) => (won(i) ? 0.62 : 0.52), () => 0.55, won,
      () => ({ side: 'yes', filled: 10, cost: 5.9, fee: 0.18 })));
    expect(e.brier.diffHigh!).toBeLessThan(0);
    expect(e.verdict).toBe('no_net_edge');
  });

  it('even a surviving model earns only the owner\'s review, and a rule change excludes its market', () => {
    const won = (i: number) => i % 10 < 7;
    const r = rows(240, (i) => (won(i) ? 0.8 : 0.3), () => 0.5, won,
      (i) => ({ side: 'yes', filled: 10, cost: 5, fee: 0.18 + (i % 2) * 0 }));
    const e = evaluate(r);
    expect(e.verdict).toBe('survived_holdout_owner_review');
    expect(e.sentence).toMatch(/grants nothing/);
    const changed = evaluate(r.map((x) => (x.marketTicker === 'M0000' ? { ...x, ruleUnchanged: false } : x)));
    expect(changed.excluded.ruleChanged).toBe(1);
    expect(changed.resolvedMarkets).toBe(239);
  });

  it('a simulated fill its own book does not reproduce is excluded, not trusted', () => {
    const won = (i: number) => i % 10 < 7;
    const r = rows(240, (i) => (won(i) ? 0.8 : 0.3), () => 0.5, won, () => ({ side: 'yes', filled: 10, cost: 5, fee: 0.18 }))
      .map((x, i) => (i === 1 ? { ...x, fillReproduces: false } : x));
    const e = evaluate(r);
    expect(e.excluded.fillNotReproduced).toBe(1);
    expect(e.simulated.trades).toBe(239);
  });

  it('the same evidence always gives the same digest', () => {
    const r = rows(20, () => 0.6, () => 0.5, (i) => i % 2 === 0);
    expect(evaluationDigest(evaluate(r))).toBe(evaluationDigest(evaluate([...r])));
  });
});
