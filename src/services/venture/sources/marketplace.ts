// =============================================================================
// FOUNDRY - what already sells on a marketplace, and for how much (F3)
//
// The one public trace of a TRANSACTION a stranger can read: a marketplace
// listing that buyers have reviewed was bought — on Etsy only a buyer may
// review — and its price is what the seller asks. That is the `transaction`
// stance (migration 253: "something actually sold"), distinct from a search
// box (people look) and a forum (people complain).
//
// READ THROUGH ETSY'S OPEN API v3, never its website (terms.ts: scraping the
// site is forbidden), with the application key the owner placed:
//   * findAllListingsActive — GET /v3/application/listings/active?keywords=…
//     &sort_on=created|score&limit=… → { count, results: [{ listing_id, title,
//     description, price: { amount, divisor, currency_code }, num_favorers,
//     url, creation_timestamp|created_timestamp }] };
//   * getReviewsByListing — GET /v3/application/listings/{id}/reviews?limit=1
//     → { count, results }, read for the few most relevant listings only.
// SHAPED FROM THE OPENAPI 3.0.0 SPECIFICATION, NOT LIVE: no request here has
// been answered by Etsy; the tests replay fixtures shaped from the spec. And
// whether Etsy's API terms permit a seller's application to read other shops'
// listings for research is NOT KNOWN (terms.ts, PENDING 49): until he confirms,
// the door refuses and this eye is not asked.
//
// WHAT IT CANNOT TELL US: how many were sold (a review count is a floor, and
// most buyers never review), what the seller kept, and anything about buyers
// who searched and bought nothing.
// =============================================================================
import { readJson } from './fetching.js';
import { relevanceOf } from './npm-registry.js';

export const ETSY_LISTINGS = 'https://openapi.etsy.com/v3/application/listings';

export const CAN_SEE = 'what is listed for sale on a marketplace about a problem, at what price, how many people '
  + 'saved it, and how many buyers reviewed it, which only a buyer can';
export const CANNOT_SEE = 'how many were sold (a review count is a floor), what the seller kept, and what buyers '
  + 'who bought nothing were looking for';
export const WOULD_MOST_HELP = 'a sales count from a system of record, which only a seller has, or a real offer of our own';
export const CANNOT_TELL_US: Array<{ question: string; wouldNeed: string }> = [
  { question: 'how many copies of what exists actually sell', wouldNeed: 'a seller\'s own sales record' },
  { question: 'whether a buyer would choose ours over what already sells', wouldNeed: 'a real offer shown beside it' },
];

export interface MarketListing {
  id: string; title: string; url: string; priceCents: number | null; currency: string | null;
  favourites: number | null; reviews: number | null; listedAt: string | null;
  relevant: boolean; shared: string[];
}
export interface MarketSearch {
  terms: string; url: string; observedAt: Date; total: number; found: MarketListing[];
  /** The middle asking price of the relevant listings, in cents; null with none priced. */
  medianPriceCents: number | null;
}

function money(p: unknown): { cents: number; currency: string } | null {
  const o = p as { amount?: unknown; divisor?: unknown; currency_code?: unknown } | null;
  const amount = Number(o?.amount); const divisor = Number(o?.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0 || typeof o?.currency_code !== 'string') return null;
  return { cents: Math.round((amount / divisor) * 100), currency: o.currency_code };
}

/** WHAT SELLS FOR THESE WORDS: newest first, or by Etsy's own relevance. Reviews read for the three most relevant. */
export async function whatSells(terms: string, apiKeyHeader: string, opts: { newest?: boolean; limit?: number } = {}): Promise<MarketSearch> {
  const q = new URLSearchParams({ keywords: terms, sort_on: opts.newest ? 'created' : 'score', limit: String(Math.min(Math.max(opts.limit ?? 25, 1), 100)) });
  const url = `${ETSY_LISTINGS}/active?${q.toString()}`;
  const headers = { 'x-api-key': apiKeyHeader };
  const observedAt = new Date();
  const body = await readJson<{ count?: number; results?: Array<Record<string, unknown>> }>(url, headers);
  const found: MarketListing[] = (body.results ?? []).map((r) => {
    const id = String(r.listing_id ?? '');
    const title = typeof r.title === 'string' ? r.title : '';
    const description = typeof r.description === 'string' ? r.description.slice(0, 600) : null;
    const price = money(r.price);
    const rel = relevanceOf(terms, title, description);
    const created = Number(r.created_timestamp ?? r.creation_timestamp);
    return {
      id, title, url: typeof r.url === 'string' && r.url.startsWith('https://') ? r.url : `https://www.etsy.com/listing/${id}`,
      priceCents: price?.cents ?? null, currency: price?.currency ?? null,
      favourites: Number.isFinite(Number(r.num_favorers)) ? Number(r.num_favorers) : null, reviews: null,
      listedAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : null,
      relevant: rel.relevant, shared: rel.shared,
    };
  }).filter((l) => l.id !== '' && l.title !== '');
  for (const l of found.filter((x) => x.relevant).slice(0, 3)) {
    const rev = await readJson<{ count?: number }>(`${ETSY_LISTINGS}/${encodeURIComponent(l.id)}/reviews?limit=1`, headers);
    l.reviews = Number.isFinite(Number(rev.count)) ? Number(rev.count) : null;
  }
  const prices = found.filter((x) => x.relevant && x.priceCents !== null).map((x) => x.priceCents!).sort((a, b) => a - b);
  return { terms, url, observedAt, total: Number(body.count ?? found.length), found,
    medianPriceCents: prices.length ? prices[Math.floor((prices.length - 1) / 2)]! : null };
}
