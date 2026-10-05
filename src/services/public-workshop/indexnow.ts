// =============================================================================
// FOUNDRY — telling search engines a Workshop page changed (Roadmap 2027 R38).
//
// A page on a new domain waits on a crawler's own schedule, and a 30-day test
// window can close before anything indexes it. IndexNow (Bing, Yandex, Seznam,
// Naver; DuckDuckGo reads Bing) takes a list of changed addresses from the
// site's owner, proved by a key file the site itself serves. Google does not
// use it; the sitemap, now dated, and the owner's Search Console property are
// what reach Google.
//
// THE KEY IS PUBLIC BY DESIGN: the protocol requires it to be served at the
// site's root, so it is a constant in the reviewed program, not a secret. What
// it proves is only that whoever announces controls the site; anyone could
// announce our own addresses with it, which tells a search engine nothing it
// could not crawl anyway.
//
// WHAT IS ANNOUNCED: only pages a crawler is meant to keep, only when this pass
// put a new version up, and only once that version was read back from the
// public address. Through the gateway, under the capability that publishes the
// page, deduplicated by the exact list of addresses at their live versions.
// =============================================================================

import { createHash } from 'node:crypto';

export const INDEXNOW_KEY = '8dd8475947a6c334519bf2dede3fb310';
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;

/** The paths worth announcing from one pass: changed, verified, and meant to be indexed. */
export function pathsToAnnounce(input: { published: string[]; unverified: string[]; indexed: ReadonlySet<string> }): string[] {
  const failing = new Set(input.unverified.map((u) => u.split(':')[0]!));
  return input.published.filter((p) => input.indexed.has(p) && !failing.has(p)).sort();
}

/** One announcement's body, as the protocol wants it. */
export function announcementFor(origin: string, paths: string[]): { host: string; key: string; keyLocation: string; urlList: string[] } {
  const host = new URL(origin).hostname;
  return { host, key: INDEXNOW_KEY, keyLocation: `${origin}${INDEXNOW_KEY_PATH}`, urlList: paths.map((p) => `${origin}${p}`) };
}

/** Deduplication for one announcement: each entry is an address at its live version (`url@vN`). */
export const announcementKey = (founderId: string, urlsAtVersions: string[]): string =>
  `indexnow:${founderId}:${createHash('sha256').update(urlsAtVersions.join('\n')).digest('hex').slice(0, 24)}`;
