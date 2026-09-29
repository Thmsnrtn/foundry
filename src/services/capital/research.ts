// =============================================================================
// FOUNDRY — capital research: one question, asked honestly of each venue.
//
// The owner asked on 29 September 2026 for the research to work across every
// trading venue at once. Each venue is one reader below (VENUE_READERS) and
// one row in `capital_venues` (migration 365); everything after the read — the
// snapshot, the sealed forecasts, the simulated fill, the official result, the
// evaluation — is the same code for every venue.
//
// The loop, each pass (jobs: capital_research_observe), for each venue with a
// question being observed:
//   1. Archive the contract's rules as the venue states them, by digest.
//   2. Find the one market whose window is open now, and read its book.
//   3. Read the proxy price — labelled a proxy, never the settlement source.
//   4. Seal two forecasts per observing thesis before the window closes: the
//      market's own price (the baseline) and the proxy-drift model, which
//      skips, with its reason, where the venue publishes no reference level.
//      A model forecast that clears the fixed rule gets ONE simulated fill
//      against the displayed book, marked simulated by the schema.
//   5. Import the venue's official result for every closed market observed.
// and, daily, evaluate each thesis and keep the evaluation with its digest.
// One venue asking Foundry to wait does not blind the others.
//
// Nothing here can place, change or cancel an order, read an account, or hold
// a credential (`public-markets.ts`; `research-cannot-reach-an-order`). Nothing
// here writes a product, an experiment, a sale or a ledger entry.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { parseBook, simulateTake, topOfBook, marketImpliedYes, type Level } from './book.js';
import { VENUE_FEES } from './fees.js';
import { DECISION_RULE, chooseSide, proxyDriftYes, sigmaOneMinute } from './models.js';
import { evaluate, evaluationDigest, type Evaluation, type ResolvedForecast } from './evaluation.js';
import {
  MarketAskedToWait, MarketDataMissing, POLY_SERIES, polymarketSlugFor, readMarket, readOpenMarkets, readOrderbook,
  readPolymarketBook, readPolymarketWindow, readProxy, readSeries,
  type Fetcher, type MarketRecord, type SeriesRules,
} from './public-markets.js';

type Row = Record<string, unknown>;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');


// ─── The venues ──────────────────────────────────────────────────────────────

export type Venue = 'kalshi' | 'polymarket';

/** What one venue's reader must answer. Every read is a public GET (`public-markets.ts`). */
interface VenueReader {
  venue: Venue;
  series: string;
  /** The window open now, its rules as published, and how to read its book; or why there is none. */
  current(now: Date, f?: Fetcher): Promise<{ market: MarketRecord; rules: SeriesRules; readBook: () => Promise<unknown> } | { none: string }>;
  /** A market's record, once closed, for its official result. */
  settled(ticker: string, f?: Fetcher): Promise<MarketRecord>;
  /** Why the proxy model cannot run here, when it cannot. */
  noProxyModel: string | null;
}

/** The market whose window contains `now`, if exactly one does. */
export function activeMarket(markets: MarketRecord[], now: Date): MarketRecord | null {
  const t = now.getTime();
  const live = markets.filter((m) => Date.parse(m.openTime) <= t && t < Date.parse(m.closeTime));
  return live.length === 1 ? live[0] : null;
}

export const VENUE_READERS: Record<Venue, VenueReader> = {
  kalshi: {
    venue: 'kalshi', series: 'KXBTC15M', noProxyModel: null,
    async current(now, f) {
      const rules = await readSeries('KXBTC15M', f);
      const market = activeMarket(await readOpenMarkets('KXBTC15M', f), now);
      if (!market) return { none: 'no single market window is open now' };
      return { market, rules, readBook: () => readOrderbook(market.ticker, f) };
    },
    settled: (ticker, f) => readMarket(ticker, f),
  },
  polymarket: {
    venue: 'polymarket', series: POLY_SERIES,
    noProxyModel: 'Polymarket does not publish the price at the beginning of the window, so the proxy model has no reference level to measure against',
    async current(now, f) {
      let w;
      try { w = await readPolymarketWindow(polymarketSlugFor(now), f); } catch (err) {
        if (err instanceof MarketDataMissing) return { none: `no Polymarket window is listed for now: ${err.message}` };
        throw err;
      }
      const t = now.getTime();
      if (!(Date.parse(w.market.openTime) <= t && t < Date.parse(w.market.closeTime))) return { none: 'the listed window is not open now' };
      const upToken = w.upToken;
      return { market: w.market, rules: w.rules, readBook: () => readPolymarketBook(upToken, f) };
    },
    settled: async (ticker, f) => (await readPolymarketWindow(ticker, f)).market,
  },
};

/** The one series researched on each venue so far: the question the legacy bot claimed to answer. */
export const RESEARCH_SERIES: Record<Venue, string> = { kalshi: VENUE_READERS.kalshi.series, polymarket: VENUE_READERS.polymarket.series };

export const isVenue = (v: unknown): v is Venue => v === 'kalshi' || v === 'polymarket';

const ALTERNATIVE_USE = 'The same money held, or the same attention spent on the digital products, which have customers and '
  + 'no capital at risk.';

export const THESIS_TEXT: Record<Venue, { hypothesis: string; falsifier: string; alternativeUse: string }> = {
  kalshi: {
    hypothesis: 'A public spot price, measured against the official reference level, forecasts a 15-minute Bitcoin up/down '
      + 'contract better than the market\'s own price — by enough to pay the fee.',
    falsifier: 'Over at least 200 resolved markets fixed in advance, the model\'s Brier score is not better than the '
      + 'market\'s with 95% confidence, or its simulated result after fees and one cent of adverse fill is not positive '
      + 'in both halves.',
    alternativeUse: ALTERNATIVE_USE,
  },
  polymarket: {
    hypothesis: 'Polymarket and Kalshi ask the same 15-minute Bitcoin question of different settlement sources. Their prices, '
      + 'read at the same moment, differ by more than both venues\' fees often enough — and their results agree reliably enough — '
      + 'that the difference is worth studying.',
    falsifier: 'Over at least 200 windows both venues resolved, the prices read at the same moment rarely differ by more than '
      + 'both fees, or the two venues\' results disagree often enough that a price difference is a different question, not a mispricing.',
    alternativeUse: ALTERNATIVE_USE,
  },
};

export class CapitalRefused extends Error {}

// ─── The owner's question ────────────────────────────────────────────────────

export async function beginObserving(founderId: string, venue: Venue = 'kalshi'): Promise<string> {
  if (!isVenue(venue)) throw new CapitalRefused('not a venue research reads');
  const series = RESEARCH_SERIES[venue];
  const open = (await query(
    `SELECT id FROM capital_research_theses WHERE founder_id = ? AND venue = ? AND series_ticker = ? AND status = 'observing'`,
    [founderId, venue, series])).rows[0] as Row | undefined;
  if (open) throw new CapitalRefused('this question is already being observed');
  const id = nanoid();
  const text = THESIS_TEXT[venue];
  await query(
    `INSERT INTO capital_research_theses (id, founder_id, venue, series_ticker, hypothesis, falsifier, alternative_use, begun_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, founderId, venue, series, text.hypothesis, text.falsifier, text.alternativeUse, `founder:${founderId}`]);
  return id;
}

export async function stopObserving(founderId: string, because: string, venue: Venue = 'kalshi'): Promise<boolean> {
  const words = because.trim().slice(0, 500);
  if (!words) throw new CapitalRefused('a stop says why');
  if (!isVenue(venue)) throw new CapitalRefused('not a venue research reads');
  const r = await query(
    `UPDATE capital_research_theses SET status = 'stopped', stopped_at = datetime('now'), stopped_because = ?
      WHERE founder_id = ? AND venue = ? AND status = 'observing'`, [words, founderId, venue]);
  return r.rowsAffected > 0;
}

// ─── One pass of observation ─────────────────────────────────────────────────

/** What one venue's pass did. */
export interface ObservationPass {
  venue: Venue;
  observed: string | null;
  because: string;
  forecasts: number;
  simulatedFills: number;
}

/** What one run did, across every venue being observed. */
export interface ObservationRun {
  because: string;
  resolved: number;
  passes: ObservationPass[];
}

/** One line for a log or a terminal. */
export function describeRun(r: ObservationRun): string {
  if (r.passes.length === 0) return `${r.because}; ${String(r.resolved)} official results imported`;
  return r.passes.map((p) => `${p.venue}: ${p.observed ?? 'nothing observed'} — ${p.because}; `
    + `${String(p.forecasts)} forecasts, ${String(p.simulatedFills)} simulated fills`).join(' | ')
    + `; ${String(r.resolved)} official results imported`;
}

async function archiveRules(venue: Venue, rules: SeriesRules): Promise<string> {
  const id = sha(JSON.stringify([venue, rules.seriesTicker, rules.settlementSource, rules.settlementNote, rules.feeType, rules.feeMultiplier]));
  await query(
    `INSERT OR IGNORE INTO capital_contract_rules (id, venue, series_ticker, settlement_source, settlement_note, fee_type, fee_multiplier)
     VALUES (?,?,?,?,?,?,?)`,
    [id, venue, rules.seriesTicker, rules.settlementSource, rules.settlementNote, rules.feeType, rules.feeMultiplier]);
  return id;
}

const minutesBetween = (fromIso: string, toIso: string): number => (Date.parse(toIso) - Date.parse(fromIso)) / 60_000;

type Proxy = { price: number; observedAt: string; sigma: number | null } | null;

export async function observeOnce(opts: { now?: Date; fetcher?: Fetcher } = {}): Promise<ObservationRun> {
  const now = opts.now ?? new Date();
  const theses = (await query(
    `SELECT id, founder_id, venue, series_ticker FROM capital_research_theses WHERE status = 'observing' ORDER BY begun_at, rowid`)).rows as Row[];
  const resolved = await importResolutions(opts);
  if (theses.length === 0) return { because: 'nobody is observing', resolved, passes: [] };
  // The proxy is read at most once per run and shared: every venue's model is measured against the same spot price.
  let proxy: Proxy | undefined;
  const proxyOnce = async (): Promise<Proxy> => {
    if (proxy !== undefined) return proxy;
    try {
      const p = await readProxy(opts.fetcher);
      proxy = { price: p.price, observedAt: p.observedAt, sigma: sigmaOneMinute(p.closes) };
    } catch {
      proxy = null;
    }
    return proxy;
  };
  const passes: ObservationPass[] = [];
  for (const venue of Object.keys(VENUE_READERS) as Venue[]) {
    const reader = VENUE_READERS[venue];
    const mine = theses.filter((t) => String(t.venue) === venue && String(t.series_ticker) === reader.series);
    if (mine.length === 0) continue;
    try {
      passes.push(await observeVenue(reader, mine, now, opts.fetcher, proxyOnce));
    } catch (err) {
      // ONE VENUE ASKING TO WAIT DOES NOT BLIND THE OTHERS. Nothing is written for it, and nothing concluded.
      if (!(err instanceof MarketAskedToWait)) throw err;
      passes.push({ venue, observed: null, because: `${err.message}; nothing concluded`, forecasts: 0, simulatedFills: 0 });
    }
  }
  return { because: 'observed each venue with a question open', resolved, passes };
}

async function observeVenue(reader: VenueReader, theses: Row[], now: Date, fetcher: Fetcher | undefined,
  proxyOnce: () => Promise<Proxy>): Promise<ObservationPass> {
  const venue = reader.venue;
  const pass = (observed: string | null, because: string, forecasts = 0, simulatedFills = 0): ObservationPass =>
    ({ venue, observed, because, forecasts, simulatedFills });
  const found = await reader.current(now, fetcher);
  if ('none' in found) return pass(null, found.none);
  const { market, rules } = found;
  const minutesRemaining = minutesBetween(now.toISOString(), market.closeTime);
  const minutesElapsed = minutesBetween(market.openTime, now.toISOString());
  if (minutesElapsed < DECISION_RULE.minMinutesElapsed) {
    return pass(null, `${minutesElapsed.toFixed(1)} minutes into the window, fewer than ${String(DECISION_RULE.minMinutesElapsed)}`);
  }
  if (minutesRemaining < DECISION_RULE.minMinutesRemaining) {
    return pass(null, `${minutesRemaining.toFixed(1)} minutes left in the window, fewer than ${String(DECISION_RULE.minMinutesRemaining)}`);
  }
  const done = (await query(
    `SELECT DISTINCT thesis_id FROM capital_forecasts WHERE market_ticker = ?`, [market.ticker])).rows.map((r) => String((r as Row).thesis_id));
  const todo = theses.filter((t) => !done.includes(String(t.id)));
  if (todo.length === 0) return pass(market.ticker, 'already forecast for this window');

  const book = parseBook(await found.readBook());
  const ruleId = await archiveRules(venue, rules);
  const top = topOfBook(book);
  const proxy = reader.noProxyModel ? null : await proxyOnce();

  const snapshotId = nanoid();
  await query(
    `INSERT INTO capital_market_snapshots
       (id, venue, series_ticker, market_ticker, rule_id, open_time, close_time, floor_strike, rules_primary_digest,
        received_at, best_yes_bid, best_yes_ask, yes_book_json, no_book_json,
        proxy_price, proxy_source, proxy_observed_at, proxy_sigma_1m)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [snapshotId, venue, reader.series, market.ticker, ruleId, market.openTime, market.closeTime, market.floorStrike, sha(market.rulesPrimary),
      now.toISOString(), top.yesBid, top.yesAsk,
      JSON.stringify(book.yesBids.slice(0, 20)), JSON.stringify(book.noBids.slice(0, 20)),
      proxy?.price ?? null, proxy ? 'coinbase BTC-USD spot (proxy)' : null, proxy?.observedAt ?? null, proxy?.sigma ?? null]);

  const fees = VENUE_FEES[venue];
  const feeRule = { feeType: rules.feeType, feeMultiplier: rules.feeMultiplier };
  const baseline = marketImpliedYes(book);
  const drift = reader.noProxyModel ? { pYes: null, because: reader.noProxyModel } as const
    : proxyDriftYes({ proxyPrice: proxy?.price ?? null, strike: market.floorStrike, sigma1m: proxy?.sigma ?? null, minutesRemaining });
  let forecasts = 0; let simulatedFills = 0;
  for (const t of todo) {
    const founderId = String(t.founder_id); const thesisId = String(t.id);
    await query(
      `INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
       VALUES (?,?,?,?,?,'market_implied_v1',?,'skip',?)`,
      [nanoid(), founderId, thesisId, snapshotId, market.ticker, baseline,
        baseline === null ? 'one side of the book was empty, so the market states no price'
          : 'the baseline never trades: it is the market\'s own price']);
    forecasts++;

    const fid = nanoid();
    if (drift.pYes === null) {
      await query(
        `INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
         VALUES (?,?,?,?,?,'proxy_drift_v1',NULL,'skip',?)`,
        [fid, founderId, thesisId, snapshotId, market.ticker, drift.because]);
      forecasts++;
      continue;
    }
    const choice = chooseSide({ pYes: drift.pYes, yesAsk: top.yesAsk, noAsk: top.noAsk, feeFor: (p) => fees.perContract(feeRule, p) });
    await query(
      `INSERT INTO capital_forecasts (id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason)
       VALUES (?,?,?,?,?,'proxy_drift_v1',?,?,?)`,
      [fid, founderId, thesisId, snapshotId, market.ticker, drift.pYes, choice.side ?? 'skip',
        choice.side ? `net edge ${choice.edge.net.toFixed(4)} per contract on ${choice.side.toUpperCase()} after a fee of ${choice.edge.feePerContract.toFixed(2)}`
          : choice.because]);
    forecasts++;
    if (choice.side) {
      const take = simulateTake(book, choice.side, DECISION_RULE.contracts);
      await query(
        `INSERT INTO capital_paper_fills (id, founder_id, forecast_id, side, contracts_requested, contracts_filled, cost_dollars, fee_dollars, fee_version)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [nanoid(), founderId, fid, choice.side, take.requested, take.filled, take.cost,
          fees.forLevels(feeRule, take.taken), fees.version]);
      simulatedFills++;
    }
  }
  return pass(market.ticker, 'observed and forecast before the window closed', forecasts, simulatedFills);
}

// ─── The venue's official answer ─────────────────────────────────────────────

export async function importResolutions(opts: { now?: Date; fetcher?: Fetcher } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const due = (await query(
    `SELECT s.venue, s.market_ticker FROM capital_market_snapshots s
      WHERE datetime(s.close_time) <= datetime(?, '-1 minute')
        AND NOT EXISTS (SELECT 1 FROM capital_resolutions r WHERE r.market_ticker = s.market_ticker)
      GROUP BY s.venue, s.market_ticker
      ORDER BY s.venue, s.market_ticker LIMIT 48`, [now.toISOString()])).rows as Row[];
  let n = 0;
  const waiting = new Set<string>();
  for (const row of due) {
    const venue = String(row.venue); const ticker = String(row.market_ticker);
    if (!isVenue(venue) || waiting.has(venue)) continue;
    // ONE MISSING MARKET DOES NOT BLIND THE REST. A market the venue cannot
    // find stays unresolved and is counted as such on the page; a venue that
    // asks to wait is left until the next pass, and the others carry on.
    let m: MarketRecord;
    try {
      m = await VENUE_READERS[venue].settled(ticker, opts.fetcher);
    } catch (err) {
      if (err instanceof MarketDataMissing) continue;
      if (err instanceof MarketAskedToWait) { waiting.add(venue); continue; }
      throw err;
    }
    if (m.result === null || m.ticker !== ticker) continue; // not settled yet: nothing is concluded
    await query(
      `INSERT OR IGNORE INTO capital_resolutions
         (market_ticker, venue, result, expiration_value, floor_strike, settlement_ts, rules_primary, rules_primary_digest)
       VALUES (?,?,?,?,?,?,?,?)`,
      [m.ticker, venue, m.result, m.expirationValue, m.floorStrike, m.settlementTs, m.rulesPrimary, sha(m.rulesPrimary)]);
    n++;
  }
  return n;
}

// ─── What the evidence says ──────────────────────────────────────────────────

async function resolvedForecasts(thesisId: string): Promise<ResolvedForecast[]> {
  const rows = (await query(
    `SELECT f.market_ticker, s.close_time, f.model, f.p_yes, f.decision, r.result,
            s.rules_primary_digest = r.rules_primary_digest AS rule_unchanged,
            s.yes_book_json, s.no_book_json,
            p.side AS fill_side, p.contracts_requested, p.contracts_filled, p.cost_dollars, p.fee_dollars
       FROM capital_forecasts f
       JOIN capital_market_snapshots s ON s.id = f.snapshot_id
       JOIN capital_resolutions r ON r.market_ticker = f.market_ticker
       LEFT JOIN capital_paper_fills p ON p.forecast_id = f.id
      WHERE f.thesis_id = ?
      ORDER BY s.close_time, f.market_ticker, f.model`, [thesisId])).rows as Row[];
  return rows.map((r) => ({
    marketTicker: String(r.market_ticker), closeTime: String(r.close_time),
    model: String(r.model) as ResolvedForecast['model'],
    pYes: r.p_yes === null ? null : Number(r.p_yes),
    decision: String(r.decision) as ResolvedForecast['decision'],
    result: String(r.result) as 'yes' | 'no',
    ruleUnchanged: Number(r.rule_unchanged) === 1,
    fill: r.fill_side == null ? null : {
      side: String(r.fill_side) as 'yes' | 'no', filled: Number(r.contracts_filled), cost: Number(r.cost_dollars),
      fee: r.fee_dollars === null ? null : Number(r.fee_dollars),
    },
    // THE SAME SNAPSHOT GIVES THE SAME FILL. The book kept with the snapshot is
    // walked again; a stored fill it does not reproduce is excluded, not trusted.
    fillReproduces: r.fill_side == null ? undefined : (() => {
      const again = simulateTake(
        { yesBids: JSON.parse(String(r.yes_book_json)) as Level[], noBids: JSON.parse(String(r.no_book_json)) as Level[] },
        String(r.fill_side) as 'yes' | 'no', Number(r.contracts_requested));
      return again.filled === Number(r.contracts_filled) && Math.abs(again.cost - Number(r.cost_dollars)) < 1e-9;
    })(),
  }));
}

export async function evaluateThesis(thesisId: string): Promise<Evaluation> {
  const t = (await query(`SELECT founder_id FROM capital_research_theses WHERE id = ?`, [thesisId])).rows[0] as Row | undefined;
  if (!t) throw new CapitalRefused('no such thesis');
  const e = evaluate(await resolvedForecasts(thesisId));
  await query(
    `INSERT INTO capital_evaluations (id, founder_id, thesis_id, resolved_count, verdict, result_json, result_digest)
     VALUES (?,?,?,?,?,?,?)`,
    [nanoid(), String(t.founder_id), thesisId, e.resolvedMarkets, e.verdict, JSON.stringify(e), evaluationDigest(e)]);
  return e;
}

/** Evaluate each observing question whose last evaluation is a day old, or which has none. */
export async function evaluateDue(): Promise<number> {
  const ids = (await query(
    `SELECT t.id FROM capital_research_theses t
      WHERE t.status = 'observing'
        AND NOT EXISTS (SELECT 1 FROM capital_evaluations e
                         WHERE e.thesis_id = t.id AND datetime(e.computed_at) > datetime('now', '-1 day'))`)).rows
    .map((r) => String((r as Row).id));
  for (const id of ids) await evaluateThesis(id);
  return ids.length;
}

// ─── What the owner reads ────────────────────────────────────────────────────

export interface CapitalResearchReading {
  venue: Venue;
  /** Why this venue's proxy model cannot run, when it cannot. */
  noProxyModel: string | null;
  thesis: { id: string; status: string; begunAt: string; begunByOwner: boolean; stoppedAt: string | null; stoppedBecause: string | null;
    hypothesis: string; falsifier: string; alternativeUse: string } | null;
  lastWindow: LastWindow | null;
  counts: { snapshots: number; forecasts: number; resolved: number; simulatedFills: number; proxyMissing: number };
  lastSnapshotAt: string | null;
  rules: { settlementSource: string; settlementNote: string | null; feeType: string | null; feeMultiplier: number | null; firstSeenAt: string } | null;
  latestRule: string | null;
  evaluation: { computedAt: string; verdict: string; digest: string; resolvedCount: number; result: Evaluation } | null;
}

/** The most recent window observed: what was seen, what each forecast said, and what was simulated. */
export interface LastWindow {
  marketTicker: string; receivedAt: string; closeTime: string; floorStrike: number | null;
  yesBid: number | null; yesAsk: number | null;
  proxy: { price: number; source: string; observedAt: string; sigma1m: number | null } | null;
  forecasts: Array<{ model: string; pYes: number | null; decision: string; reason: string }>;
  fill: { side: string; requested: number; filled: number; cost: number; fee: number | null; feeVersion: string } | null;
}

export async function capitalResearchReading(founderId: string, venue: Venue = 'kalshi'): Promise<CapitalResearchReading> {
  const noProxyModel = VENUE_READERS[venue].noProxyModel;
  const t = (await query(
    `SELECT id, status, begun_at, begun_by, stopped_at, stopped_because, hypothesis, falsifier, alternative_use
       FROM capital_research_theses WHERE founder_id = ? AND venue = ? ORDER BY status = 'observing' DESC, begun_at DESC, rowid DESC LIMIT 1`,
    [founderId, venue])).rows[0] as Row | undefined;
  const empty = { snapshots: 0, forecasts: 0, resolved: 0, simulatedFills: 0, proxyMissing: 0 };
  if (!t) return { venue, noProxyModel, thesis: null, lastWindow: null, counts: empty, lastSnapshotAt: null, rules: null, latestRule: null, evaluation: null };
  const id = String(t.id);
  const c = (await query(
    `SELECT (SELECT COUNT(DISTINCT snapshot_id) FROM capital_forecasts WHERE thesis_id = ?) AS snapshots,
            (SELECT COUNT(*) FROM capital_forecasts WHERE thesis_id = ?) AS forecasts,
            (SELECT COUNT(DISTINCT f.market_ticker) FROM capital_forecasts f
               JOIN capital_resolutions r ON r.market_ticker = f.market_ticker WHERE f.thesis_id = ?) AS resolved,
            (SELECT COUNT(*) FROM capital_paper_fills p JOIN capital_forecasts f ON f.id = p.forecast_id
              WHERE f.thesis_id = ?) AS fills,
            (SELECT COUNT(*) FROM capital_forecasts WHERE thesis_id = ? AND model = 'proxy_drift_v1' AND p_yes IS NULL) AS proxy_missing,
            (SELECT MAX(s.received_at) FROM capital_market_snapshots s
               JOIN capital_forecasts f ON f.snapshot_id = s.id WHERE f.thesis_id = ?) AS last_at`,
    [id, id, id, id, id, id])).rows[0] as Row;
  const rule = (await query(
    `SELECT settlement_source, settlement_note, fee_type, fee_multiplier, first_seen_at FROM capital_contract_rules
      WHERE venue = ? AND series_ticker = ? ORDER BY first_seen_at DESC, rowid DESC LIMIT 1`, [venue, RESEARCH_SERIES[venue]])).rows[0] as Row | undefined;
  const latestRule = (await query(
    `SELECT r.rules_primary FROM capital_resolutions r
      WHERE r.market_ticker IN (SELECT market_ticker FROM capital_forecasts WHERE thesis_id = ?)
      ORDER BY r.settlement_ts DESC LIMIT 1`, [id])).rows[0] as Row | undefined;
  const ev = (await query(
    `SELECT computed_at, verdict, resolved_count, result_json, result_digest FROM capital_evaluations
      WHERE thesis_id = ? ORDER BY computed_at DESC, rowid DESC LIMIT 1`, [id])).rows[0] as Row | undefined;
  const lw = (await query(
    `SELECT s.id, s.market_ticker, s.received_at, s.close_time, s.floor_strike, s.best_yes_bid, s.best_yes_ask,
            s.proxy_price, s.proxy_source, s.proxy_observed_at, s.proxy_sigma_1m
       FROM capital_market_snapshots s
      WHERE s.id IN (SELECT snapshot_id FROM capital_forecasts WHERE thesis_id = ?)
      ORDER BY s.received_at DESC, s.rowid DESC LIMIT 1`, [id])).rows[0] as Row | undefined;
  let lastWindow: LastWindow | null = null;
  if (lw) {
    const fs = (await query(
      `SELECT model, p_yes, decision, reason FROM capital_forecasts WHERE thesis_id = ? AND snapshot_id = ? ORDER BY model, rowid`,
      [id, String(lw.id)])).rows as Row[];
    const fill = (await query(
      `SELECT p.side, p.contracts_requested, p.contracts_filled, p.cost_dollars, p.fee_dollars, p.fee_version
         FROM capital_paper_fills p JOIN capital_forecasts f ON f.id = p.forecast_id
        WHERE f.thesis_id = ? AND f.snapshot_id = ? LIMIT 1`, [id, String(lw.id)])).rows[0] as Row | undefined;
    const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
    lastWindow = {
      marketTicker: String(lw.market_ticker), receivedAt: String(lw.received_at), closeTime: String(lw.close_time),
      floorStrike: n(lw.floor_strike), yesBid: n(lw.best_yes_bid), yesAsk: n(lw.best_yes_ask),
      proxy: lw.proxy_price == null ? null : { price: Number(lw.proxy_price), source: String(lw.proxy_source),
        observedAt: String(lw.proxy_observed_at), sigma1m: n(lw.proxy_sigma_1m) },
      forecasts: fs.map((f) => ({ model: String(f.model), pYes: n(f.p_yes), decision: String(f.decision), reason: String(f.reason) })),
      fill: fill ? { side: String(fill.side), requested: Number(fill.contracts_requested), filled: Number(fill.contracts_filled),
        cost: Number(fill.cost_dollars), fee: n(fill.fee_dollars), feeVersion: String(fill.fee_version) } : null,
    };
  }
  return {
    venue, noProxyModel,
    lastWindow,
    thesis: {
      id, status: String(t.status), begunAt: String(t.begun_at), begunByOwner: String(t.begun_by) === `founder:${founderId}`,
      stoppedAt: t.stopped_at == null ? null : String(t.stopped_at),
      stoppedBecause: t.stopped_because == null ? null : String(t.stopped_because),
      hypothesis: String(t.hypothesis), falsifier: String(t.falsifier), alternativeUse: String(t.alternative_use),
    },
    counts: {
      snapshots: Number(c.snapshots ?? 0), forecasts: Number(c.forecasts ?? 0), resolved: Number(c.resolved ?? 0),
      simulatedFills: Number(c.fills ?? 0),
      // Where the venue publishes no reference level the model never runs; that is said once, not counted as a failed read.
      proxyMissing: noProxyModel ? 0 : Number(c.proxy_missing ?? 0),
    },
    lastSnapshotAt: c.last_at == null ? null : String(c.last_at),
    rules: rule ? {
      settlementSource: String(rule.settlement_source), settlementNote: rule.settlement_note == null ? null : String(rule.settlement_note),
      feeType: rule.fee_type == null ? null : String(rule.fee_type), feeMultiplier: rule.fee_multiplier == null ? null : Number(rule.fee_multiplier),
      firstSeenAt: String(rule.first_seen_at),
    } : null,
    latestRule: latestRule ? String(latestRule.rules_primary) : null,
    evaluation: ev ? { computedAt: String(ev.computed_at), verdict: String(ev.verdict), digest: String(ev.result_digest),
      resolvedCount: Number(ev.resolved_count),
      result: JSON.parse(String(ev.result_json)) as Evaluation } : null,
  };
}

// ─── Across venues ───────────────────────────────────────────────────────────

/** The venues research may read, in the owner's words (`capital_venues`, migration 365). */
export async function researchVenues(): Promise<Array<{ venue: Venue; name: string; whatItIs: string }>> {
  return ((await query(`SELECT venue, name, what_it_is FROM capital_venues ORDER BY sort_rank, rowid`)).rows as Row[])
    .filter((r) => isVenue(r.venue))
    .map((r) => ({ venue: String(r.venue) as Venue, name: String(r.name), whatItIs: String(r.what_it_is) }));
}

/**
 * THE SAME WINDOW, ON TWO VENUES. Kalshi and Polymarket each list a
 * fifteen-minute Bitcoin up/down question closing at the same instant, settled
 * on different sources (CF Benchmarks BRTI against the previous window's
 * average; Chainlink's TWAP against the window's opening price). This reads,
 * for every window both venues were observed in:
 *   · how far apart their prices were, read at the same pass;
 *   · whether their official results agreed;
 *   · each venue's own price scored against its own result;
 *   · how often buying YES on one and NO on the other cost less than a dollar
 *     after both venues' fees, at the displayed top of book — and what that
 *     would have paid given the real results. A disagreement between the
 *     results is where such a pair loses both legs, and it is counted.
 * One contract, top of book only, no queue: a simulation, never money, and
 * never an instruction.
 */
export interface CrossVenueReading {
  windows: number;
  sameMoment: number;
  priceGap: { mean: number; max: number; pairs: number } | null;
  results: { both: number; agreed: number };
  brier: { kalshi: number; polymarket: number; pairs: number } | null;
  pairsUnderADollar: { count: number; resolved: number; simulatedNet: number; bothLegsLost: number };
  lastPaired: { closeTime: string; kalshiMid: number | null; polymarketMid: number | null } | null;
}

export async function crossVenueReading(): Promise<CrossVenueReading> {
  const rows = (await query(
    `WITH firsts AS (
       SELECT s.*, s.rowid AS rid, ROW_NUMBER() OVER (PARTITION BY s.venue, datetime(s.close_time) ORDER BY s.received_at, s.rowid) AS rn
         FROM capital_market_snapshots s)
     SELECT k.close_time, k.received_at AS k_at, p.received_at AS p_at,
            k.best_yes_bid AS kb, k.best_yes_ask AS ka, p.best_yes_bid AS pb, p.best_yes_ask AS pa,
            kr.result AS k_result, pr.result AS p_result,
            krule.fee_type AS k_ft, krule.fee_multiplier AS k_fm, prule.fee_type AS p_ft, prule.fee_multiplier AS p_fm
       FROM firsts k
       JOIN firsts p ON p.venue = 'polymarket' AND p.rn = 1 AND datetime(p.close_time) = datetime(k.close_time)
       JOIN capital_contract_rules krule ON krule.id = k.rule_id
       JOIN capital_contract_rules prule ON prule.id = p.rule_id
       LEFT JOIN capital_resolutions kr ON kr.market_ticker = k.market_ticker
       LEFT JOIN capital_resolutions pr ON pr.market_ticker = p.market_ticker
      WHERE k.venue = 'kalshi' AND k.rn = 1
      ORDER BY datetime(k.close_time), k.rid`)).rows as Row[];
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const mid = (b: number | null, a: number | null): number | null => (b === null || a === null ? null : (b + a) / 2);
  const gaps: number[] = []; let sameMoment = 0; let both = 0; let agreed = 0;
  let bk = 0; let bp = 0; let bn = 0;
  const pairs = { count: 0, resolved: 0, simulatedNet: 0, bothLegsLost: 0 };
  for (const r of rows) {
    if (Math.abs(Date.parse(String(r.k_at)) - Date.parse(String(r.p_at))) <= 60_000) sameMoment++;
    const kb = n(r.kb); const ka = n(r.ka); const pb = n(r.pb); const pa = n(r.pa);
    const km = mid(kb, ka); const pm = mid(pb, pa);
    if (km !== null && pm !== null) gaps.push(Math.abs(km - pm));
    const kRes = r.k_result == null ? null : String(r.k_result); const pRes = r.p_result == null ? null : String(r.p_result);
    if (kRes && pRes) {
      both++; if (kRes === pRes) agreed++;
      if (km !== null && pm !== null) {
        bk += (km - (kRes === 'yes' ? 1 : 0)) ** 2; bp += (pm - (pRes === 'yes' ? 1 : 0)) ** 2; bn++;
      }
    }
    // Two ways to hold both sides of the same question, one on each venue.
    const kRule = { feeType: r.k_ft == null ? null : String(r.k_ft), feeMultiplier: n(r.k_fm) };
    const pRule = { feeType: r.p_ft == null ? null : String(r.p_ft), feeMultiplier: n(r.p_fm) };
    const legs: Array<{ cost: number | null; pays: (k: string, p: string) => number }> = [
      { cost: ka !== null && pb !== null ? costOf(ka, VENUE_FEES.kalshi.perContract(kRule, ka), 1 - pb, VENUE_FEES.polymarket.perContract(pRule, 1 - pb)) : null,
        pays: (k, p) => (k === 'yes' ? 1 : 0) + (p === 'no' ? 1 : 0) },
      { cost: pa !== null && kb !== null ? costOf(pa, VENUE_FEES.polymarket.perContract(pRule, pa), 1 - kb, VENUE_FEES.kalshi.perContract(kRule, 1 - kb)) : null,
        pays: (k, p) => (p === 'yes' ? 1 : 0) + (k === 'no' ? 1 : 0) },
    ];
    const best = legs.filter((l) => l.cost !== null).sort((a, b) => a.cost! - b.cost!)[0];
    if (best && best.cost! < 1) {
      pairs.count++;
      if (kRes && pRes) {
        const paid = best.pays(kRes, pRes);
        pairs.resolved++; pairs.simulatedNet += paid - best.cost!; if (paid === 0) pairs.bothLegsLost++;
      }
    }
  }
  const last = rows[rows.length - 1];
  const round = (x: number): number => Math.round(x * 10_000) / 10_000;
  return {
    windows: rows.length, sameMoment,
    priceGap: gaps.length ? { mean: round(gaps.reduce((a, b) => a + b, 0) / gaps.length), max: round(Math.max(...gaps)), pairs: gaps.length } : null,
    results: { both, agreed },
    brier: bn ? { kalshi: round(bk / bn), polymarket: round(bp / bn), pairs: bn } : null,
    pairsUnderADollar: { ...pairs, simulatedNet: round(pairs.simulatedNet) },
    lastPaired: last ? { closeTime: String(last.close_time), kalshiMid: mid(n(last.kb), n(last.ka)), polymarketMid: mid(n(last.pb), n(last.pa)) } : null,
  };
}

/** Both legs' prices and fees, or null when either fee is not one this version knows. */
function costOf(priceA: number, feeA: number | null, priceB: number, feeB: number | null): number | null {
  if (feeA === null || feeB === null || !(priceA > 0 && priceA < 1) || !(priceB > 0 && priceB < 1)) return null;
  return Math.round((priceA + feeA + priceB + feeB) * 1e6) / 1e6;
}
