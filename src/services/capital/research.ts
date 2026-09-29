// =============================================================================
// FOUNDRY — capital research: one question, asked honestly of one market.
//
// The loop, each pass (jobs: capital_research_observe):
//   1. Archive the series' rules as the venue states them, by digest.
//   2. Find the one market whose window is open now, and read its book.
//   3. Read the proxy price — labelled a proxy, never the settlement source.
//   4. Seal two forecasts per observing thesis before the window closes: the
//      market's own price (the baseline) and the proxy-drift model. A model
//      forecast that clears the fixed rule gets ONE simulated fill against the
//      displayed book, marked simulated by the schema.
//   5. Import the venue's official result for every closed market observed.
// and, daily, evaluate each thesis and keep the evaluation with its digest.
//
// Nothing here can place, change or cancel an order, read an account, or hold
// a credential (`public-markets.ts`; `research-cannot-reach-an-order`). Nothing
// here writes a product, an experiment, a sale or a ledger entry.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { parseBook, simulateTake, topOfBook, marketImpliedYes, type Level } from './book.js';
import { FEE_VERSION, takerFee, takerFeeForLevels } from './fees.js';
import { DECISION_RULE, chooseSide, proxyDriftYes, sigmaOneMinute } from './models.js';
import { evaluate, evaluationDigest, type Evaluation, type ResolvedForecast } from './evaluation.js';
import {
  MarketAskedToWait, MarketDataMissing, readMarket, readOpenMarkets, readOrderbook, readProxy, readSeries,
  type Fetcher, type MarketRecord, type SeriesRules,
} from './public-markets.js';

type Row = Record<string, unknown>;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The one series researched so far: the question the legacy bot claimed to answer. */
export const RESEARCH_SERIES = 'KXBTC15M';

export const THESIS_TEXT = {
  hypothesis: 'A public spot price, measured against the official reference level, forecasts a 15-minute Bitcoin up/down '
    + 'contract better than the market\'s own price — by enough to pay the fee.',
  falsifier: 'Over at least 200 resolved markets fixed in advance, the model\'s Brier score is not better than the '
    + 'market\'s with 95% confidence, or its simulated result after fees and one cent of adverse fill is not positive '
    + 'in both halves.',
  alternativeUse: 'The same money held, or the same attention spent on the digital products, which have customers and '
    + 'no capital at risk.',
} as const;

export class CapitalRefused extends Error {}

// ─── The owner's question ────────────────────────────────────────────────────

export async function beginObserving(founderId: string, series: string = RESEARCH_SERIES): Promise<string> {
  const open = (await query(
    `SELECT id FROM capital_research_theses WHERE founder_id = ? AND series_ticker = ? AND status = 'observing'`,
    [founderId, series])).rows[0] as Row | undefined;
  if (open) throw new CapitalRefused('this question is already being observed');
  const id = nanoid();
  await query(
    `INSERT INTO capital_research_theses (id, founder_id, venue, series_ticker, hypothesis, falsifier, alternative_use, begun_by)
     VALUES (?,?,'kalshi',?,?,?,?,?)`,
    [id, founderId, series, THESIS_TEXT.hypothesis, THESIS_TEXT.falsifier, THESIS_TEXT.alternativeUse, `founder:${founderId}`]);
  return id;
}

export async function stopObserving(founderId: string, because: string): Promise<boolean> {
  const words = because.trim().slice(0, 500);
  if (!words) throw new CapitalRefused('a stop says why');
  const r = await query(
    `UPDATE capital_research_theses SET status = 'stopped', stopped_at = datetime('now'), stopped_because = ?
      WHERE founder_id = ? AND status = 'observing'`, [words, founderId]);
  return r.rowsAffected > 0;
}

// ─── One pass of observation ─────────────────────────────────────────────────

export interface ObservationPass {
  observed: string | null;
  because: string;
  forecasts: number;
  simulatedFills: number;
  resolved: number;
}

async function archiveRules(rules: SeriesRules): Promise<string> {
  const id = sha(JSON.stringify([rules.seriesTicker, rules.settlementSource, rules.settlementNote, rules.feeType, rules.feeMultiplier]));
  await query(
    `INSERT OR IGNORE INTO capital_contract_rules (id, venue, series_ticker, settlement_source, settlement_note, fee_type, fee_multiplier)
     VALUES (?,'kalshi',?,?,?,?,?)`,
    [id, rules.seriesTicker, rules.settlementSource, rules.settlementNote, rules.feeType, rules.feeMultiplier]);
  return id;
}

const minutesBetween = (fromIso: string, toIso: string): number => (Date.parse(toIso) - Date.parse(fromIso)) / 60_000;

/** The market whose window contains `now`, if exactly one does. */
export function activeMarket(markets: MarketRecord[], now: Date): MarketRecord | null {
  const t = now.getTime();
  const live = markets.filter((m) => Date.parse(m.openTime) <= t && t < Date.parse(m.closeTime));
  return live.length === 1 ? live[0] : null;
}

export async function observeOnce(opts: { now?: Date; fetcher?: Fetcher } = {}): Promise<ObservationPass> {
  const now = opts.now ?? new Date();
  const theses = (await query(
    `SELECT id, founder_id, series_ticker FROM capital_research_theses WHERE status = 'observing' ORDER BY begun_at, rowid`)).rows as Row[];
  const resolved = await importResolutions(opts);
  if (theses.length === 0) return { observed: null, because: 'nobody is observing', forecasts: 0, simulatedFills: 0, resolved };

  const series = RESEARCH_SERIES;
  const rules = await readSeries(series, opts.fetcher);
  const ruleId = await archiveRules(rules);
  const market = activeMarket(await readOpenMarkets(series, opts.fetcher), now);
  if (!market) return { observed: null, because: 'no single market window is open now', forecasts: 0, simulatedFills: 0, resolved };
  const minutesRemaining = minutesBetween(now.toISOString(), market.closeTime);
  const minutesElapsed = minutesBetween(market.openTime, now.toISOString());
  if (minutesElapsed < DECISION_RULE.minMinutesElapsed) {
    return { observed: null, because: `${minutesElapsed.toFixed(1)} minutes into the window, fewer than ${String(DECISION_RULE.minMinutesElapsed)}`, forecasts: 0, simulatedFills: 0, resolved };
  }
  if (minutesRemaining < DECISION_RULE.minMinutesRemaining) {
    return { observed: null, because: `${minutesRemaining.toFixed(1)} minutes left in the window, fewer than ${String(DECISION_RULE.minMinutesRemaining)}`, forecasts: 0, simulatedFills: 0, resolved };
  }
  const pending = theses.filter((t) => String(t.series_ticker) === series);
  const done = (await query(
    `SELECT DISTINCT thesis_id FROM capital_forecasts WHERE market_ticker = ?`, [market.ticker])).rows.map((r) => String((r as Row).thesis_id));
  const todo = pending.filter((t) => !done.includes(String(t.id)));
  if (todo.length === 0) return { observed: market.ticker, because: 'already forecast for this window', forecasts: 0, simulatedFills: 0, resolved };

  const book = parseBook(await readOrderbook(market.ticker, opts.fetcher));
  const top = topOfBook(book);
  let proxy: { price: number; observedAt: string; sigma: number | null } | null = null;
  try {
    const p = await readProxy(opts.fetcher);
    proxy = { price: p.price, observedAt: p.observedAt, sigma: sigmaOneMinute(p.closes) };
  } catch (err) {
    if (err instanceof MarketAskedToWait) throw err;
    proxy = null;
  }

  const snapshotId = nanoid();
  await query(
    `INSERT INTO capital_market_snapshots
       (id, venue, series_ticker, market_ticker, rule_id, open_time, close_time, floor_strike, rules_primary_digest,
        received_at, best_yes_bid, best_yes_ask, yes_book_json, no_book_json,
        proxy_price, proxy_source, proxy_observed_at, proxy_sigma_1m)
     VALUES (?,'kalshi',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [snapshotId, series, market.ticker, ruleId, market.openTime, market.closeTime, market.floorStrike, sha(market.rulesPrimary),
      now.toISOString(), top.yesBid, top.yesAsk,
      JSON.stringify(book.yesBids.slice(0, 20)), JSON.stringify(book.noBids.slice(0, 20)),
      proxy?.price ?? null, proxy ? 'coinbase BTC-USD spot (proxy)' : null, proxy?.observedAt ?? null, proxy?.sigma ?? null]);

  const feeRule = { feeType: rules.feeType, feeMultiplier: rules.feeMultiplier };
  const baseline = marketImpliedYes(book);
  const drift = proxyDriftYes({ proxyPrice: proxy?.price ?? null, strike: market.floorStrike, sigma1m: proxy?.sigma ?? null, minutesRemaining });
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
    const choice = chooseSide({ pYes: drift.pYes, yesAsk: top.yesAsk, noAsk: top.noAsk, feeFor: (p) => takerFee(feeRule, 1, p) });
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
          takerFeeForLevels(feeRule, take.taken), FEE_VERSION]);
      simulatedFills++;
    }
  }
  return { observed: market.ticker, because: 'observed and forecast before the window closed', forecasts, simulatedFills, resolved };
}

// ─── The venue's official answer ─────────────────────────────────────────────

export async function importResolutions(opts: { now?: Date; fetcher?: Fetcher } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const due = (await query(
    `SELECT DISTINCT s.market_ticker FROM capital_market_snapshots s
      WHERE datetime(s.close_time) <= datetime(?, '-1 minute')
        AND NOT EXISTS (SELECT 1 FROM capital_resolutions r WHERE r.market_ticker = s.market_ticker)
      ORDER BY s.market_ticker LIMIT 24`, [now.toISOString()])).rows.map((r) => String((r as Row).market_ticker));
  let n = 0;
  for (const ticker of due) {
    // ONE MISSING MARKET DOES NOT BLIND THE REST. A market the venue cannot
    // find, live or historical, stays unresolved and is counted as such on
    // the page; only the venue asking to wait stops the pass.
    let m: MarketRecord;
    try {
      m = await readMarket(ticker, opts.fetcher);
    } catch (err) {
      if (err instanceof MarketDataMissing) continue;
      throw err;
    }
    if (m.result === null) continue; // not settled yet: nothing is concluded
    await query(
      `INSERT OR IGNORE INTO capital_resolutions
         (market_ticker, venue, result, expiration_value, floor_strike, settlement_ts, rules_primary, rules_primary_digest)
       VALUES (?,'kalshi',?,?,?,?,?,?)`,
      [m.ticker, m.result, m.expirationValue, m.floorStrike, m.settlementTs, m.rulesPrimary, sha(m.rulesPrimary)]);
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

export async function capitalResearchReading(founderId: string): Promise<CapitalResearchReading> {
  const t = (await query(
    `SELECT id, status, begun_at, begun_by, stopped_at, stopped_because, hypothesis, falsifier, alternative_use
       FROM capital_research_theses WHERE founder_id = ? ORDER BY status = 'observing' DESC, begun_at DESC LIMIT 1`,
    [founderId])).rows[0] as Row | undefined;
  const empty = { snapshots: 0, forecasts: 0, resolved: 0, simulatedFills: 0, proxyMissing: 0 };
  if (!t) return { thesis: null, lastWindow: null, counts: empty, lastSnapshotAt: null, rules: null, latestRule: null, evaluation: null };
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
      WHERE series_ticker = ? ORDER BY first_seen_at DESC LIMIT 1`, [RESEARCH_SERIES])).rows[0] as Row | undefined;
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
    lastWindow,
    thesis: {
      id, status: String(t.status), begunAt: String(t.begun_at), begunByOwner: String(t.begun_by) === `founder:${founderId}`,
      stoppedAt: t.stopped_at == null ? null : String(t.stopped_at),
      stoppedBecause: t.stopped_because == null ? null : String(t.stopped_because),
      hypothesis: String(t.hypothesis), falsifier: String(t.falsifier), alternativeUse: String(t.alternative_use),
    },
    counts: {
      snapshots: Number(c.snapshots ?? 0), forecasts: Number(c.forecasts ?? 0), resolved: Number(c.resolved ?? 0),
      simulatedFills: Number(c.fills ?? 0), proxyMissing: Number(c.proxy_missing ?? 0),
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
