// =============================================================================
// FOUNDRY — the only way capital research reaches the world: GET, public,
// allowlisted, with no credential.
//
// Every request is a GET to one of a few named public paths, per host. There
// is no signing key, no account header, no POST, and no path under
// `/portfolio` (Kalshi) or `/order`, `/orders`, `/trades` or an API-key
// header (Polymarket) — the paths an order, a fill, a balance or a position
// would need. The
// allowlist is enforced before any network call, and
// `research-cannot-reach-an-order` asserts the source of this whole directory
// contains none of those things.
//
// When the venue asks Foundry to wait (HTTP 429), it waits and concludes
// nothing, as the Etsy reader does (B5).
// =============================================================================

import { safeFetch } from '../outbound/ssrf.js';

export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
export const PROXY_BASE = 'https://api.exchange.coinbase.com';
export const POLY_GAMMA = 'https://gamma-api.polymarket.com';
export const POLY_CLOB = 'https://clob.polymarket.com';

/** The paths capital research may read, per host. Anything else is refused before the network. */
const ALLOWED: Record<string, RegExp[]> = {
  'api.elections.kalshi.com': [
    /^\/trade-api\/v2\/series\/[A-Z0-9]+$/,
    /^\/trade-api\/v2\/markets$/,
    /^\/trade-api\/v2\/markets\/[A-Z0-9-]+$/,
    /^\/trade-api\/v2\/markets\/[A-Z0-9-]+\/orderbook$/,
    /^\/trade-api\/v2\/historical\/markets\/[A-Z0-9-]+$/,
  ],
  'api.exchange.coinbase.com': [
    /^\/products\/BTC-USD\/ticker$/,
    /^\/products\/BTC-USD\/candles$/,
  ],
  // Polymarket's public market list and its public book. Nothing else on
  // either host — not the order, trade, or API-key paths.
  'gamma-api.polymarket.com': [/^\/events$/],
  'clob.polymarket.com': [/^\/book$/],
};

export class MarketDataRefused extends Error {}
export class MarketAskedToWait extends Error {
  constructor(public readonly waitSeconds: number) { super(`the venue asked to wait ${String(waitSeconds)}s`); }
}
export class MarketDataMissing extends Error {}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const defaultFetcher: Fetcher = (url, init) => safeFetch(url, init);

/** Refuse anything that is not a public GET on an allowlisted path. */
export function assertReadable(url: string): URL {
  const u = new URL(url);
  const paths = u.protocol === 'https:' ? ALLOWED[u.hostname] : undefined;
  if (!paths) throw new MarketDataRefused(`not a public market-data host: ${u.hostname}`);
  if (!paths.some((re) => re.test(u.pathname))) throw new MarketDataRefused(`not a path capital research may read: ${u.pathname}`);
  return u;
}

export async function readJson(url: string, fetcher: Fetcher = defaultFetcher): Promise<unknown> {
  assertReadable(url);
  const res = await fetcher(url, { method: 'GET', headers: { accept: 'application/json' } });
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    throw new MarketAskedToWait(Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : 60);
  }
  if (res.status === 404) throw new MarketDataMissing(`not found: ${new URL(url).pathname}`);
  if (!res.ok) throw new Error(`market data read failed: HTTP ${String(res.status)} for ${new URL(url).pathname}`);
  return res.json();
}

// ─── The shapes read, and only the fields used ───────────────────────────────

export interface SeriesRules {
  seriesTicker: string; settlementSource: string; settlementNote: string | null;
  feeType: string | null; feeMultiplier: number | null;
}

export interface MarketRecord {
  ticker: string; eventTicker: string | null; status: string;
  openTime: string; closeTime: string;
  floorStrike: number | null; strikeType: string | null;
  rulesPrimary: string;
  result: 'yes' | 'no' | null; expirationValue: number | null; settlementTs: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseSeries(raw: unknown): SeriesRules {
  const s = (raw as { series?: Record<string, unknown> })?.series;
  if (!s || !str(s.ticker)) throw new MarketDataMissing('the series record has no ticker');
  const sources = Array.isArray(s.settlement_sources) ? s.settlement_sources as Array<Record<string, unknown>> : [];
  const source = sources.map((x) => str(x.name)).filter(Boolean).join(', ');
  if (!source) throw new MarketDataMissing('the series names no settlement source');
  const info = (s.product_metadata as { important_info?: { markdown?: unknown } } | undefined)?.important_info;
  return {
    seriesTicker: String(s.ticker), settlementSource: source, settlementNote: str(info?.markdown),
    feeType: str(s.fee_type), feeMultiplier: numOrNull(s.fee_multiplier),
  };
}

export function parseMarket(raw: unknown): MarketRecord {
  const m = ((raw as { market?: unknown })?.market ?? raw) as Record<string, unknown>;
  const ticker = str(m?.ticker); const openTime = str(m?.open_time); const closeTime = str(m?.close_time);
  const rules = str(m?.rules_primary);
  if (!ticker || !openTime || !closeTime || !rules) throw new MarketDataMissing('a market record is missing its ticker, times or rule');
  const result = m.result === 'yes' || m.result === 'no' ? m.result : null;
  return {
    ticker, eventTicker: str(m.event_ticker), status: String(m.status ?? ''),
    openTime, closeTime,
    floorStrike: numOrNull(m.floor_strike), strikeType: str(m.strike_type), rulesPrimary: rules,
    result, expirationValue: numOrNull(m.expiration_value), settlementTs: str(m.settlement_ts),
  };
}

export const readSeries = async (series: string, f?: Fetcher): Promise<SeriesRules> =>
  parseSeries(await readJson(`${KALSHI_BASE}/series/${series}`, f));

export async function readOpenMarkets(series: string, f?: Fetcher): Promise<MarketRecord[]> {
  const raw = await readJson(`${KALSHI_BASE}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=20`, f) as { markets?: unknown[] };
  return (raw.markets ?? []).flatMap((m) => { try { return [parseMarket(m)]; } catch { return []; } });
}

/** A market's record; a market too old for the live endpoint is read from the historical one. */
export async function readMarket(ticker: string, f?: Fetcher): Promise<MarketRecord> {
  try {
    return parseMarket(await readJson(`${KALSHI_BASE}/markets/${ticker}`, f));
  } catch (err) {
    if (!(err instanceof MarketDataMissing)) throw err;
    return parseMarket(await readJson(`${KALSHI_BASE}/historical/markets/${ticker}`, f));
  }
}

export const readOrderbook = async (ticker: string, f?: Fetcher): Promise<unknown> =>
  readJson(`${KALSHI_BASE}/markets/${ticker}/orderbook`, f);

/** The proxy: a public spot price and its last hour of one-minute closes, oldest first. Never the settlement source. */
export async function readProxy(f?: Fetcher): Promise<{ price: number; observedAt: string; closes: number[] }> {
  const t = await readJson(`${PROXY_BASE}/products/BTC-USD/ticker`, f) as Record<string, unknown>;
  const price = numOrNull(t.price); const observedAt = str(t.time);
  if (price === null || !observedAt) throw new MarketDataMissing('the proxy ticker had no price or time');
  const candles = await readJson(`${PROXY_BASE}/products/BTC-USD/candles?granularity=60`, f);
  const rows = Array.isArray(candles) ? candles as unknown[][] : [];
  const closes = rows.slice(0, 61).map((r) => numOrNull(r?.[4])).filter((x): x is number => x !== null).reverse();
  return { price, observedAt, closes };
}

// ─── Polymarket: the same question, asked on another venue ───────────────────
//
// Polymarket lists one "Bitcoin Up or Down" event per fifteen-minute window,
// under a slug that names the window's start in Unix seconds (read 29
// September 2026, tests/fixtures/polymarket). "Up" is read as YES: the market
// resolves Up if Chainlink's BTC/USD TWAP over the window is at least the
// price at its beginning. That beginning price is NOT published by the venue,
// so no reference level is recorded — nothing here estimates one and calls it
// official. The result is read only once the venue marks the market closed
// and its oracle resolution `resolved`, with prices exactly 1 and 0.

export const POLY_SERIES = 'btc-up-or-down-15m';
const POLY_WINDOW_SECONDS = 900;

/** The slug of the window containing `now`. */
export function polymarketSlugFor(now: Date): string {
  return `btc-updown-15m-${String(Math.floor(now.getTime() / 1000 / POLY_WINDOW_SECONDS) * POLY_WINDOW_SECONDS)}`;
}

export interface PolymarketWindow {
  market: MarketRecord;
  rules: SeriesRules;
  /** The CLOB token that pays if the window resolves Up. */
  upToken: string;
}

const parseList = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  try { const x = JSON.parse(v) as unknown; return Array.isArray(x) ? x : null; } catch { return null; }
};

/** The fee schedule as the market states it; anything but the known shape is named, never assumed. */
function polymarketFeeRule(m: Record<string, unknown>): { feeType: string | null; feeMultiplier: number | null } {
  const type = str(m.feeType);
  const sched = m.feeSchedule as Record<string, unknown> | undefined;
  const rate = numOrNull(sched?.rate);
  if (!type || !sched || rate === null) return { feeType: type, feeMultiplier: null };
  const known = type === 'crypto_fees_v2' && numOrNull(sched.exponent) === 1 && sched.takerOnly === true;
  return { feeType: known ? type : `${type} (a shape this version does not know)`, feeMultiplier: rate };
}

/** One window's event, as gamma returns it for `?slug=`. */
export function parsePolymarketEvent(raw: unknown, slug: string): PolymarketWindow {
  const events = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [raw as Record<string, unknown>];
  const e = events.find((x) => x && x.slug === slug);
  if (!e) throw new MarketDataMissing(`no Polymarket event ${slug}`);
  const markets = Array.isArray(e.markets) ? e.markets as Array<Record<string, unknown>> : [];
  if (markets.length !== 1) throw new MarketDataMissing(`Polymarket event ${slug} does not hold exactly one market`);
  const m = markets[0];
  const outcomes = parseList(m.outcomes); const tokens = parseList(m.clobTokenIds);
  if (!outcomes || outcomes.length !== 2 || outcomes[0] !== 'Up' || outcomes[1] !== 'Down') {
    throw new MarketDataMissing(`Polymarket event ${slug} is not an Up/Down market this reader knows`);
  }
  const upToken = tokens && typeof tokens[0] === 'string' && /^[0-9]{10,100}$/.test(tokens[0]) ? tokens[0] : null;
  const openTime = str(m.eventStartTime) ?? str(e.startTime); const closeTime = str(m.endDate);
  const rulesPrimary = str(m.description); const source = str(m.resolutionSource) ?? str(e.resolutionSource);
  if (!upToken || !openTime || !closeTime || !rulesPrimary || !source) {
    throw new MarketDataMissing(`Polymarket event ${slug} is missing its token, times, rule or resolution source`);
  }
  const prices = parseList(m.outcomePrices)?.map((p) => String(p));
  const resolved = m.closed === true && m.umaResolutionStatus === 'resolved';
  const result = !resolved || !prices ? null
    : prices[0] === '1' && prices[1] === '0' ? 'yes' as const
      : prices[0] === '0' && prices[1] === '1' ? 'no' as const : null;
  const fee = polymarketFeeRule(m);
  return {
    upToken,
    market: {
      ticker: slug, eventTicker: str(e.ticker), status: m.closed === true ? 'closed' : m.active === true ? 'active' : '',
      openTime, closeTime, floorStrike: null, strikeType: null, rulesPrimary,
      result, expirationValue: null, settlementTs: result ? str(e.closedTime) ?? str(m.closedTime) : null,
    },
    rules: {
      seriesTicker: POLY_SERIES, settlementSource: `Chainlink BTC/USD TWAP data stream (${source})`,
      settlementNote: 'Up if the TWAP over the window is at least the price at its beginning; the venue does not publish that beginning price.',
      feeType: fee.feeType, feeMultiplier: fee.feeMultiplier,
    },
  };
}

export async function readPolymarketWindow(slug: string, f?: Fetcher): Promise<PolymarketWindow> {
  if (!/^btc-updown-15m-[0-9]{9,11}$/.test(slug)) throw new MarketDataRefused(`not a window this reader knows: ${slug}`);
  return parsePolymarketEvent(await readJson(`${POLY_GAMMA}/events?slug=${slug}`, f), slug);
}

/** The Up token's public book, as the same bids-only shape Kalshi publishes: an Up ask at a is a Down bid at 1 − a. */
export async function readPolymarketBook(upToken: string, f?: Fetcher): Promise<unknown> {
  if (!/^[0-9]{10,100}$/.test(upToken)) throw new MarketDataRefused('not a token id');
  const raw = await readJson(`${POLY_CLOB}/book?token_id=${upToken}`, f) as Record<string, unknown>;
  if (raw?.asset_id !== upToken) throw new MarketDataMissing('the book returned is for another token');
  const levels = (v: unknown): Array<[number, number]> => (Array.isArray(v) ? v as Array<Record<string, unknown>> : [])
    .flatMap((l) => { const p = numOrNull(l?.price); const s = numOrNull(l?.size); return p === null || s === null ? [] : [[p, s] as [number, number]]; });
  return {
    orderbook_fp: {
      yes_dollars: levels(raw.bids),
      no_dollars: levels(raw.asks).map(([p, s]) => [Math.round((1 - p) * 10_000) / 10_000, s]),
    },
  };
}
