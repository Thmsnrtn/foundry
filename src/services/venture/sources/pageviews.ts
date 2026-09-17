// =============================================================================
// FOUNDRY - how often something is looked up
//
// Wikipedia's pageview counts are a number from a system of record about how
// many people looked something up by name, month by month. It is measured use
// of an article, not of a product, and it only exists for things that have an
// article: a niche too small for an encyclopedia is invisible here, which is
// a fact about the instrument and is said as one.
//
// Two public calls, no credential: find the article for a phrase, then read
// its views for the last full months.
// =============================================================================
import { readJson } from './fetching.js';
import { relevanceOf } from './npm-registry.js';

const OPENSEARCH = 'https://en.wikipedia.org/w/api.php';
const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user';

export const CAN_SEE = 'how many people looked an article up by name, month by month, from '
  + 'a system of record';
export const CANNOT_SEE = 'anything with no article, why anybody looked, and whether a reader '
  + 'is a person with the problem or a student with an essay';
export const WOULD_MOST_HELP = 'a search volume for the phrase itself, or somebody with the '
  + 'problem asked what they looked up';

export interface Lookups {
  terms: string; article: string | null; url: string; observedAt: Date;
  /** Monthly views for the article, oldest first. Empty when there is no article. */
  months: Array<{ month: string; views: number }>;
  relevant: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** HOW OFTEN THIS IS LOOKED UP, for the phrase's nearest article. */
export async function howOftenLookedUp(terms: string, now: Date = new Date()): Promise<Lookups> {
  const observedAt = now;
  const search = `${OPENSEARCH}?action=opensearch&search=${encodeURIComponent(terms)}&limit=3&format=json`;
  const body = await readJson<unknown>(search);
  const titles = Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as unknown[]).map(String) : [];
  const article = titles.find((t) => relevanceOf(terms, t, null).relevant) ?? null;
  if (article === null) return { terms, article: null, url: search, observedAt, months: [], relevant: false };
  // The last three full months, which is enough to see a level and a direction.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
  const fmt = (d: Date): string => `${String(d.getUTCFullYear())}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const url = `${PAGEVIEWS}/${encodeURIComponent(article.replace(/ /g, '_'))}/monthly/${fmt(start)}/${fmt(endDay)}`;
  const views = await readJson<{ items?: Array<{ timestamp?: string; views?: number }> }>(url);
  const months = (views.items ?? []).map((i) => ({
    month: `${String(i.timestamp ?? '').slice(0, 4)}-${String(i.timestamp ?? '').slice(4, 6)}`,
    views: Number(i.views ?? 0),
  }));
  return { terms, article, url, observedAt, months, relevant: true };
}
