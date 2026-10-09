// =============================================================================
// FOUNDRY - which public sources the eyes may read, and on what terms (F3)
//
// LEGITIMACY (CONSTITUTION): a consequential act is legitimate only inside
// "applicable external permission", and "terms that cannot yet be evaluated
// are named as unknown, not assumed satisfied". Reading a site is not
// consequential the way spending is, but reading one against its terms is
// still something a site can take action over, and the owner is the one who
// would answer for it. So every place an eye reads is named here, with the
// permission it rests on, and the one door every eye reads through
// (`sourceFetch`) refuses anything else:
//
//   * DOCUMENTED API — the site publishes an interface for exactly this kind
//     of programmatic read. Read.
//   * UNKNOWN — the endpoint answers, but no published term says a program may
//     use it this way. NOT read until the owner (or counsel) confirms, by his
//     own signed row `source_terms:<id>` = "confirmed" (PENDING 49).
//   * FORBIDDEN — the site's terms bar it, or it has no interface and only a
//     scrape would reach it. Never read, and named so nobody adds it quietly.
//
// HOW EACH VERDICT WAS REACHED, said plainly: from each provider's published
// developer documentation as this build's authors knew it; none was re-read
// live on 9 October 2026, because this build may not reach a live site. That
// is why a verdict is conservative wherever a term is not plainly an API
// licence, and why "unknown" waits for a person rather than for code.
// =============================================================================
import { query } from '../../../db/client.js';

export type TermsVerdict = 'documented_api' | 'unknown' | 'forbidden';

export interface SourceTerms {
  id: string;
  /** What is read, in the owner's words. */
  named: string;
  verdict: TermsVerdict;
  /** Where the permission (or its absence) is published. */
  terms: string;
  /** Why the verdict, one sentence a reader can argue with. */
  basis: string;
  /** Which requests this entry covers. */
  matches: (u: URL) => boolean;
}

const host = (h: string) => (u: URL): boolean => u.hostname === h;

/** EVERY SITE AN EYE MAY ASK, AND EVERY ONE IT MAY NOT. The census test reads this list. */
export const SOURCE_TERMS: readonly SourceTerms[] = Object.freeze([
  { id: 'hn_algolia', named: 'Hacker News, through its search API', verdict: 'documented_api', terms: 'https://hn.algolia.com/api',
    basis: 'Algolia publishes the HN Search API for programmatic search, newest-first included', matches: host('hn.algolia.com') },
  { id: 'npm_registry', named: 'the npm registry', verdict: 'documented_api', terms: 'https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md',
    basis: 'npm documents the public registry and download-count APIs', matches: (u) => u.hostname === 'registry.npmjs.org' || u.hostname === 'api.npmjs.org' },
  { id: 'github_issues', named: 'GitHub issue search', verdict: 'documented_api', terms: 'https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests',
    basis: 'GitHub documents the REST search API and its unauthenticated rate limit', matches: host('api.github.com') },
  { id: 'wikimedia', named: 'Wikipedia search and pageviews', verdict: 'documented_api', terms: 'https://wikimedia.org/api/rest_v1/',
    basis: 'Wikimedia documents the pageviews REST API and the MediaWiki search API, asking for a named user agent, which is sent',
    matches: (u) => u.hostname === 'wikimedia.org' || u.hostname === 'en.wikipedia.org' },
  { id: 'itunes_search', named: 'the App Store, through the iTunes Search API', verdict: 'documented_api', terms: 'https://performance-partners.apple.com/search-api',
    basis: 'Apple publishes the Search API and the customer-reviews feed for programmatic reads, rate-limited', matches: host('itunes.apple.com') },
  { id: 'remotive', named: 'Remotive remote jobs', verdict: 'documented_api', terms: 'https://remotive.com/api-documentation',
    basis: 'Remotive documents a public jobs API, asking that jobs link back to it, which every observation does', matches: host('remotive.com') },
  { id: 'stack_exchange', named: 'Stack Exchange questions', verdict: 'documented_api', terms: 'https://api.stackexchange.com/docs',
    basis: 'Stack Exchange publishes API 2.3 for reading questions, newest first included; content is CC BY-SA and every observation keeps its link',
    matches: host('api.stackexchange.com') },
  { id: 'duckduckgo_autocomplete', named: 'DuckDuckGo search suggestions', verdict: 'unknown', terms: 'https://duckduckgo.com/terms',
    basis: 'the suggestion endpoint is what DuckDuckGo\'s own search box calls; no published term licenses a program to call it', matches: host('duckduckgo.com') },
  { id: 'etsy_marketplace_search', named: 'Etsy\'s active listings, searched', verdict: 'unknown', terms: 'https://www.etsy.com/legal/api',
    basis: 'Etsy\'s Open API v3 documents findAllListingsActive and listing reviews for an application key; whether its API terms let a seller\'s app read other shops\' listings for research is not settled here',
    matches: (u) => u.hostname === 'openapi.etsy.com' && /^\/v3\/application\/listings\/(active|\d+\/reviews)$/.test(u.pathname) },
  { id: 'reddit', named: 'Reddit', verdict: 'forbidden', terms: 'https://redditinc.com/policies/data-api-terms',
    basis: 'Reddit\'s Data API terms bar commercial use without a separate agreement', matches: (u) => /(^|\.)reddit\.com$/.test(u.hostname) },
  { id: 'google_trends', named: 'Google Trends', verdict: 'forbidden', terms: 'https://policies.google.com/terms',
    basis: 'there is no public Trends API; reading it means automated queries Google\'s terms forbid', matches: (u) => u.hostname === 'trends.google.com' },
  { id: 'etsy_site', named: 'Etsy\'s website pages', verdict: 'forbidden', terms: 'https://www.etsy.com/legal/terms-of-use',
    basis: 'Etsy\'s terms forbid scraping its site; its API is the only door', matches: (u) => u.hostname === 'www.etsy.com' || u.hostname === 'etsy.com' },
  { id: 'amazon', named: 'Amazon', verdict: 'forbidden', terms: 'https://www.amazon.com/gp/help/customer/display.html?nodeId=508088',
    basis: 'Amazon\'s conditions of use forbid data mining and robots', matches: (u) => /(^|\.)amazon\.[a-z.]+$/.test(u.hostname) },
]);

/** The entry a URL falls under, or null when no entry names it. */
export function termsFor(url: string): SourceTerms | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  return SOURCE_TERMS.find((t) => t.matches(u)) ?? null;
}

/** His word on an unknown source, from his own signed row only (the guard of migration 277 refuses any other signature). */
export async function termsConfirmed(id: string): Promise<boolean> {
  const row = (await query(
    `SELECT value FROM origination_policy WHERE requirement = ? AND superseded_at IS NULL AND set_by LIKE 'founder:%'
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [`source_terms:${id}`])).rows[0] as Record<string, unknown> | undefined;
  return !!row && String(row.value) === 'confirmed';
}

export class SourceRefused extends Error {
  constructor(message: string) { super(message); this.name = 'SourceRefused'; }
}

/** MAY AN EYE READ THIS, and why not. */
export async function mayRead(url: string): Promise<{ may: true; terms: SourceTerms } | { may: false; because: string }> {
  const t = termsFor(url);
  if (!t) return { may: false, because: `${safeHost(url)} is not a source Foundry has named terms for, so it is not read` };
  if (t.verdict === 'forbidden') return { may: false, because: `${t.named} is never read: ${t.basis} (${t.terms})` };
  if (t.verdict === 'unknown' && !(await termsConfirmed(t.id))) {
    return { may: false, because: `${t.named} is not read until you confirm its terms allow it (PENDING 49): ${t.basis} (${t.terms})` };
  }
  return { may: true, terms: t };
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return 'that address'; }
}

/** May the source with this id be asked at all, today (verdict, and his word for an unknown one). */
export async function mayAsk(id: string): Promise<boolean> {
  const t = SOURCE_TERMS.find((x) => x.id === id);
  if (!t || t.verdict === 'forbidden') return false;
  return t.verdict === 'documented_api' || await termsConfirmed(t.id);
}
