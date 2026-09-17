// =============================================================================
// FOUNDRY - an app store, read two ways
//
// Apple's public search says WHAT APPS EXIST for a problem, how they are rated
// and by how many, and when they were last touched: a substitute source, like
// the package registry, for a public that does not install packages. The
// reviews feed says WHAT THEIR USERS SAY FAILS, which is a different kind of
// knowing - satisfaction - and the one a gap thesis actually needs: a crowded
// category where every review names the same missing thing is a narrower
// thesis, not a dead one.
//
// No credential, no account, no cost. And what it cannot tell us travels with
// what it can.
// =============================================================================
import { readJson, readable, maintainedSince } from './fetching.js';
import { relevanceOf } from './npm-registry.js';

const SEARCH = 'https://itunes.apple.com/search';
const REVIEWS = 'https://itunes.apple.com/us/rss/customerreviews';

export const CAN_SEE = 'which apps are published for a problem, how they are rated and by how '
  + 'many people, what they charge up front, and when they were last updated';
export const CANNOT_SEE = 'how many people actually use an app, what it earns, whether the '
  + 'ratings are honest, and what the people who never installed anything do instead';
export const WOULD_MOST_HELP = 'the developer\'s own figures, or somebody with the problem who '
  + 'tried the apps and said why they stopped';

export const CANNOT_TELL_US: Array<{ question: string; wouldNeed: string }> = [
  { question: 'whether the apps that exist are actually used, or merely published',
    wouldNeed: 'the developer\'s figures, or a source that counts people' },
  { question: 'whether the people with this problem look for an app at all',
    wouldNeed: 'what they search for, or asking one of them' },
];

export interface AppRecord {
  id: number;
  name: string;
  seller: string;
  url: string;
  /** The publisher's own words. Self-reported, and marked so. */
  description: string | null;
  price: number | null;
  rating: number | null;
  ratingCount: number;
  lastUpdated: string | null;
  maintained: boolean;
  relevant: boolean;
  shared: string[];
}

export interface AppSearch {
  terms: string; total: number; url: string; observedAt: Date; found: AppRecord[];
}

interface ItunesResult {
  trackId?: number; trackName?: string; sellerName?: string; trackViewUrl?: string;
  description?: string; price?: number; averageUserRating?: number; userRatingCount?: number;
  currentVersionReleaseDate?: string; releaseDate?: string;
}

/** WHAT APPS EXIST FOR THIS. */
export async function whatAppsExist(terms: string, limit = 10): Promise<AppSearch> {
  const url = `${SEARCH}?term=${encodeURIComponent(terms)}&entity=software&country=us&limit=${String(limit)}`;
  const observedAt = new Date();
  const body = await readJson<{ resultCount?: number; results?: ItunesResult[] }>(url);
  const found = (body.results ?? []).filter((r) => typeof r.trackId === 'number').map((r) => {
    const description = r.description ? readable(r.description).slice(0, 600) : null;
    const rel = relevanceOf(terms, r.trackName ?? '', description);
    const lastUpdated = r.currentVersionReleaseDate ?? r.releaseDate ?? null;
    return {
      id: Number(r.trackId), name: r.trackName ?? `app ${String(r.trackId)}`, seller: r.sellerName ?? 'unknown',
      url: r.trackViewUrl ?? `https://apps.apple.com/app/id${String(r.trackId)}`,
      description, price: typeof r.price === 'number' ? r.price : null,
      rating: typeof r.averageUserRating === 'number' ? r.averageUserRating : null,
      ratingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : 0,
      lastUpdated, maintained: maintainedSince(lastUpdated, observedAt),
      relevant: rel.relevant, shared: rel.shared,
    };
  });
  return { terms, total: body.resultCount ?? found.length, url, observedAt, found };
}

export interface Review {
  id: string; title: string; text: string; rating: number | null; saidAt: string | null; url: string;
}

export interface Reviews {
  appId: number; url: string; observedAt: Date; found: Review[];
}

interface FeedEntry {
  id?: { label?: string }; title?: { label?: string }; content?: { label?: string };
  updated?: { label?: string }; 'im:rating'?: { label?: string };
}

/** WHAT USERS SAY ABOUT AN APP THAT EXISTS. Most recent first, as the feed gives them. */
export async function whatUsersSay(appId: number, limit = 20): Promise<Reviews> {
  const url = `${REVIEWS}/id=${String(appId)}/sortby=mostrecent/json`;
  const observedAt = new Date();
  const body = await readJson<{ feed?: { entry?: FeedEntry | FeedEntry[] } }>(url);
  const raw = body.feed?.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = entries.slice(0, limit).map((e) => {
    const rating = Number(e['im:rating']?.label);
    return {
      id: e.id?.label ?? '', title: readable(e.title?.label ?? ''),
      text: readable(e.content?.label ?? '').slice(0, 1200),
      rating: Number.isFinite(rating) ? rating : null,
      saidAt: e.updated?.label ?? null,
      url: `https://apps.apple.com/us/app/id${String(appId)}?see-all=reviews`,
    };
  }).filter((r) => r.text.length > 0);
  return { appId, url, observedAt, found };
}
