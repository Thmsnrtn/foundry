// =============================================================================
// FOUNDRY - the first source that has actually seen the world
//
// A public package registry, read-only, no credential, no account, no cost. It
// answers the questions that decide a digital venture before anything is built:
// does a solution to this already exist, how used is it, is anybody still
// maintaining it.
//
// THREE KINDS OF KNOWING, KEPT APART. The registry's record of a package is
// something the registry observed. The package's own description is its
// publisher talking about itself. The download count is a number from a system
// of record. They are filed as three different source types on purpose,
// because an institution that recorded all three as "npm said so" would have
// learnt nothing about how sure it should be.
//
// AND WHAT IT CANNOT TELL US IS PART OF WHAT IT TELLS US. Using this source
// raises the unknowns it cannot settle, so looking is never mistaken for
// knowing. A download count is not a customer, a maintained package is not a
// good one, and none of this says whether anybody would pay.
// =============================================================================

import { safeFetch } from '../../outbound/ssrf.js';

const REGISTRY = 'https://registry.npmjs.org';
const DOWNLOADS = 'https://api.npmjs.org';

/**
 * WHAT THIS SOURCE CANNOT SETTLE, and what would.
 *
 * Stated by the source itself rather than remembered by whoever reads it. Each
 * one becomes an open unknown on any candidate this source is used for, so the
 * gaps travel with the evidence instead of being lost between the search and
 * the summary.
 */
export const CANNOT_TELL_US: Array<{ question: string; wouldNeed: string }> = [
  { question: 'whether anybody pays for any of this',
    wouldNeed: 'a pricing page, a marketplace listing with sales, or asking somebody who has the problem' },
  { question: 'whether the downloads are people or automated builds',
    wouldNeed: 'the maintainer\'s own figures, or a source that counts humans' },
  { question: 'whether an existing package actually solves the problem well',
    wouldNeed: 'its reviews, its open issues, or a person who has used it' },
  { question: 'whether the problem is painful enough to change tools over',
    wouldNeed: 'a community thread, or a conversation with somebody who has it' },
];

export interface PackageRecord {
  name: string;
  /** What the registry observed: existence, versions, dates. */
  latestVersion: string;
  firstPublished: string | null;
  lastPublished: string | null;
  versionCount: number;
  maintainerCount: number;
  /** What the publisher says about it. Self-reported, and marked so. */
  description: string | null;
  url: string;
  observedAt: Date;
}

export interface DownloadCount {
  name: string; downloads: number; from: string; to: string;
  url: string; observedAt: Date;
}

export interface Substitute {
  name: string; version: string; lastPublished: string | null;
  description: string | null; url: string;
  /** Published within eighteen months: somebody is still there. */
  maintained: boolean;
  /** Whether what it says about itself is about the thing we searched for. */
  relevant: boolean;
  /** The words it shares with the search, so the judgement can be checked. */
  shared: string[];
}

/** Eighteen months. A package untouched for longer is not being looked after. */
const MAINTAINED_DAYS = 548;

function maintained(lastPublished: string | null): boolean {
  if (lastPublished === null) return false;
  const age = (Date.now() - new Date(lastPublished).getTime()) / 86_400_000;
  return Number.isFinite(age) && age <= MAINTAINED_DAYS;
}

/** Registries answer for names, so a name has to be one. */
function safeName(name: string): string {
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name)) {
    throw new Error(`'${name}' is not a package name`);
  }
  return encodeURIComponent(name).replace('%40', '@').replace('%2F', '/');
}

export async function packageRecord(name: string): Promise<PackageRecord | null> {
  const url = `${REGISTRY}/${safeName(name)}`;
  const res = await safeFetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the registry answered ${String(res.status)} for ${name}`);
  const body = await res.json() as {
    'dist-tags'?: Record<string, string>; time?: Record<string, string>;
    versions?: Record<string, unknown>; maintainers?: unknown[]; description?: string;
  };
  const times = body.time ?? {};
  const versions = Object.keys(body.versions ?? {});
  const published = Object.entries(times)
    .filter(([k]) => k !== 'created' && k !== 'modified')
    .map(([, v]) => v).sort();
  return {
    name,
    latestVersion: body['dist-tags']?.latest ?? 'unknown',
    firstPublished: times.created ?? published[0] ?? null,
    lastPublished: times.modified ?? published.at(-1) ?? null,
    versionCount: versions.length,
    maintainerCount: (body.maintainers ?? []).length,
    description: body.description ?? null,
    url, observedAt: new Date(),
  };
}

export async function downloadsLastMonth(name: string): Promise<DownloadCount | null> {
  const url = `${DOWNLOADS}/downloads/point/last-month/${safeName(name)}`;
  const res = await safeFetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the download API answered ${String(res.status)} for ${name}`);
  const body = await res.json() as { downloads?: number; start?: string; end?: string };
  return {
    name, downloads: Number(body.downloads ?? 0),
    from: body.start ?? '', to: body.end ?? '', url, observedAt: new Date(),
  };
}

export interface SearchResult {
  query: string; total: number; found: Substitute[]; url: string; observedAt: Date;
}

/**
 * IS THIS RESULT ACTUALLY ABOUT THE THING WE SEARCHED FOR?
 *
 * The defect that made this necessary is worth stating plainly, because it is
 * the exact failure this institution exists to refuse. Asked what already
 * exists for "licence renewal deadline reminder", the registry returned fifteen
 * maintained packages — CodeMirror editor extensions, a clipboard helper, a
 * markdown previewer — and the first version of this code filed all fifteen as
 * substitutes and let them contradict the claim. Fluent, sourced, dated, and
 * completely false. Evidence that reads like research and is nothing of the
 * kind.
 *
 * A relevance search ranks by its own idea of popularity and quality, not by
 * whether a result is about your problem. So relevance is decided here, on what
 * the package actually says its name and description are, and a result that
 * mentions none of the meaningful words is not a substitute no matter how
 * highly the registry ranked it.
 *
 * It is a blunt instrument and it is honest about being one: it will miss a
 * package that solves the problem under different words. That is a false
 * negative, which shows up as "nothing already exists" and gets killed by the
 * next source. The failure it prevents is the false positive, which shows up as
 * a confident count of competitors that are not competitors.
 */
const IGNORED_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from',
  'into', 'your', 'you', 'are', 'was', 'has', 'not', 'any', 'all', 'can', 'how',
  'who', 'why', 'app', 'tool', 'api', 'data', 'software', 'service', 'system']);

function meaningfulWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !IGNORED_WORDS.has(w)))];
}

/** Words shared between the query and what the package says about itself. */
export function relevanceOf(query: string, name: string, description: string | null): {
  shared: string[]; relevant: boolean;
} {
  const wanted = meaningfulWords(query);
  const said = `${name} ${description ?? ''}`.toLowerCase();
  const shared = wanted.filter((w) => said.includes(w));
  // Two words, or the only word there was. One shared word out of four is a
  // coincidence; two is a subject.
  const enough = wanted.length <= 1 ? 1 : 2;
  return { shared, relevant: shared.length >= enough };
}

/**
 * WHAT ALREADY EXISTS FOR THIS.
 *
 * `total` is the registry's count of anything matching the words, which is not
 * a count of substitutes. `found` is what was actually looked at, each marked
 * with whether it is about the thing at all.
 */
export async function whatAlreadyExists(query: string, size = 10): Promise<SearchResult> {
  const url = `${REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}`
    + `&size=${String(Math.min(Math.max(size, 1), 25))}`;
  const res = await safeFetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`the registry answered ${String(res.status)} for a search`);
  const body = await res.json() as {
    total?: number;
    objects?: Array<{ package?: { name?: string; version?: string; date?: string;
      description?: string; links?: { npm?: string } } }>;
  };
  return {
    query, total: Number(body.total ?? 0), url, observedAt: new Date(),
    found: (body.objects ?? []).map((o) => {
      const p = o.package ?? {};
      const lastPublished = p.date ?? null;
      const name = p.name ?? 'unknown';
      const description = p.description ?? null;
      const how = relevanceOf(query, name, description);
      return {
        name, version: p.version ?? 'unknown', lastPublished, description,
        url: p.links?.npm ?? `${REGISTRY}/${name}`,
        maintained: maintained(lastPublished),
        relevant: how.relevant, shared: how.shared,
      };
    }),
  };
}
