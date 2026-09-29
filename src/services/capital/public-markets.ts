// =============================================================================
// FOUNDRY — the only way capital research reaches the world: GET, public,
// allowlisted, with no credential.
//
// Every request is a GET to one of a few named public paths. There is no
// signing key, no account header, no POST, and no path under `/portfolio` —
// the paths an order, a fill, a balance or a position would need. The
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

/** The paths capital research may read. Anything else is refused before the network. */
const ALLOWED: RegExp[] = [
  /^\/trade-api\/v2\/series\/[A-Z0-9]+$/,
  /^\/trade-api\/v2\/markets$/,
  /^\/trade-api\/v2\/markets\/[A-Z0-9-]+$/,
  /^\/trade-api\/v2\/markets\/[A-Z0-9-]+\/orderbook$/,
  /^\/trade-api\/v2\/historical\/markets\/[A-Z0-9-]+$/,
  /^\/products\/BTC-USD\/ticker$/,
  /^\/products\/BTC-USD\/candles$/,
];
const HOSTS = new Set(['api.elections.kalshi.com', 'api.exchange.coinbase.com']);

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
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) throw new MarketDataRefused(`not a public market-data host: ${u.hostname}`);
  if (!ALLOWED.some((re) => re.test(u.pathname))) throw new MarketDataRefused(`not a path capital research may read: ${u.pathname}`);
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
