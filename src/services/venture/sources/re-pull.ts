// =============================================================================
// FOUNDRY — a brief's sealed question, asked again (Roadmap 2027 R28).
//
// A weekly brief is sold as a new edition each week, and nothing asked its
// question twice: the steward re-read rows something else had already pulled,
// discovery never asks the same words again, so week two would have been week
// one with a new date. Here the sealed words are put again to the very source
// they were first put to, at most once in six days, and the answer is kept as
// a retrieval like any other, with nothing inferred from it: no claim, no
// observation, only the rows a brief may cite.
//
// EACH SOURCE'S TERMS ARE WRITTEN DOWN BESIDE IT, and a source with no terms
// here is never re-asked. The briefs that sell these rows link to each one and
// quote no person's words (R23); what is stored is what the source returned to
// an anonymous, public query.
// =============================================================================

import { query } from '../../../db/client.js';
import { recordRetrieval } from './index.js';
import { whatPeopleSaid, CAN_SEE as COMMUNITY_CAN_SEE, CANNOT_SEE as COMMUNITY_CANNOT_SEE } from './community.js';
import { whatIsReportedBroken, CAN_SEE as ISSUES_CAN_SEE, CANNOT_SEE as ISSUES_CANNOT_SEE } from './issue-trackers.js';
import { relevanceOf, whatAlreadyExists } from './npm-registry.js';

/** At most one re-ask of the same words of the same source in this many days. */
export const MIN_REPULL_DAYS = 6;

interface Asked { label: string; url: string | null; datedAt: string | null; said: string | null; relevant: boolean; sharedTerms: string[] }
interface SourceTerms {
  /** Where the original question was put; the re-ask goes to the same place. */
  host: string;
  sourceType: 'community' | 'directory';
  /** The terms of use as they bear on this use, in a sentence. */
  terms: string;
  canSee: string; cannotSee: string;
  ask: (words: string) => Promise<{ url: string; total: number; items: Asked[] }>;
}

const said = (words: string) => (r: { text: string; url: string; saidAt: string | null }): Asked => {
  const rel = relevanceOf(words, '', r.text);
  return { label: r.text.slice(0, 90), url: r.url, datedAt: r.saidAt, said: r.text.slice(0, 500), relevant: rel.relevant, sharedTerms: rel.shared };
};

export const SOURCE_TERMS: Readonly<Record<string, SourceTerms>> = {
  'hn.algolia.com': {
    host: 'hn.algolia.com', sourceType: 'community',
    terms: 'the public search API over Hacker News; anonymous queries; a brief links to each item and quotes nobody',
    canSee: COMMUNITY_CAN_SEE, cannotSee: COMMUNITY_CANNOT_SEE,
    ask: async (w) => { const d = await whatPeopleSaid(w, 15); return { url: d.url, total: d.total, items: d.found.map(said(w)) }; },
  },
  'api.github.com': {
    host: 'api.github.com', sourceType: 'community',
    terms: 'GitHub\'s public issue search, unauthenticated and within its rate limit; a brief links to each issue and quotes nobody',
    canSee: ISSUES_CAN_SEE, cannotSee: ISSUES_CANNOT_SEE,
    ask: async (w) => { const d = await whatIsReportedBroken(w, 10); return { url: d.url, total: d.total, items: d.found.map(said(w)) }; },
  },
  'registry.npmjs.org': {
    host: 'registry.npmjs.org', sourceType: 'directory',
    terms: 'the public npm registry search; package names, dates and publishers\' own descriptions, linked',
    canSee: 'published packages: that one exists, when it was last published, and what its publisher says it is for',
    cannotSee: 'whether anybody pays, whether an existing package is any good, and anything that is not a published package',
    ask: async (w) => { const r = await whatAlreadyExists(w, 10); return { url: r.url, total: r.total, items: r.found.map((f) => ({ label: f.name, url: f.url, datedAt: f.lastPublished, said: f.description, relevant: f.relevant, sharedTerms: f.shared })) }; },
  },
};

/** The source a retrieval's request went to, by host; the path decides nothing but must be one this module knows. */
function sourceOf(requestUrl: string, sourceType: string): SourceTerms | null {
  let u: URL; try { u = new URL(requestUrl); } catch { return null; }
  const s = SOURCE_TERMS[u.host];
  if (!s || s.sourceType !== sourceType) return null;
  if (u.host === 'api.github.com' && !u.pathname.startsWith('/search/issues')) return null;
  return s;
}

const isoAt = (v: unknown): number => { const t = String(v); return new Date(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`).getTime(); };

export interface RePull { asked: Array<{ host: string; sourceType: string; returned: number }>; notAsked: string[] }

/**
 * ASK THE SEALED WORDS AGAIN, of each source they were first asked of. Only
 * real retrievals of exactly these words count as "first asked"; a source with
 * no written terms, or asked within six days, is not asked, and why is said.
 * A source that fails to answer is said too, and does not stop the others.
 */
export async function rePullSealedQuery(input: { founderId: string; terms: string; sourceTypes: string[]; now?: Date }): Promise<RePull> {
  const now = input.now ?? new Date();
  const out: RePull = { asked: [], notAsked: [] };
  for (const sourceType of input.sourceTypes) {
    const earlier = (await query(
      `SELECT source, retrieved_at FROM market_retrievals
        WHERE founder_id = ? AND evidence_mode = 'real' AND source_type = ? AND terms = ?
        ORDER BY retrieved_at DESC, rowid DESC`, [input.founderId, sourceType, input.terms])).rows as unknown as Array<Record<string, unknown>>;
    if (earlier.length === 0) { out.notAsked.push(`${sourceType}: these words were never asked of it, so there is nothing to ask again`); continue; }
    const byHost = new Map<string, { source: SourceTerms; last: number }>();
    const unknown = new Set<string>();
    for (const r of earlier) {
      const s = sourceOf(String(r.source), sourceType);
      if (!s) { try { unknown.add(new URL(String(r.source)).host); } catch { unknown.add(String(r.source)); } continue; }
      const t = isoAt(r.retrieved_at);
      const seen = byHost.get(s.host);
      if (!seen || t > seen.last) byHost.set(s.host, { source: s, last: t });
    }
    for (const h of unknown) if (![...byHost.keys()].includes(h)) out.notAsked.push(`${sourceType} (${h}): no terms of use are written down for it, so it is not asked again`);
    for (const { source, last } of byHost.values()) {
      const days = (now.getTime() - last) / 86_400_000;
      if (days < MIN_REPULL_DAYS) { out.notAsked.push(`${sourceType} (${source.host}): asked ${String(Math.floor(days))} days ago; at most once in ${String(MIN_REPULL_DAYS)}`); continue; }
      try {
        const a = await source.ask(input.terms);
        await recordRetrieval({
          founderId: input.founderId, sourceType, source: a.url, terms: input.terms, returnedCount: a.total,
          canSee: source.canSee, cannotSee: source.cannotSee,
          wouldMostHelp: 'the same question a week later, which is what this is', notAlsoTried: null, evidenceMode: 'real', retrievedAt: now,
          items: a.items,
        });
        out.asked.push({ host: source.host, sourceType, returned: a.items.length });
      } catch (err) {
        out.notAsked.push(`${sourceType} (${source.host}): did not answer (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  return out;
}

/** Whether any of these sources could be asked these words again; null when one can, else why none can. */
export async function whyItCannotBeAskedAgain(founderId: string, terms: string, sourceTypes: string[]): Promise<string | null> {
  const reasons: string[] = [];
  for (const sourceType of sourceTypes) {
    const earlier = (await query(
      `SELECT DISTINCT source FROM market_retrievals WHERE founder_id = ? AND evidence_mode = 'real' AND source_type = ? AND terms = ?`,
      [founderId, sourceType, terms])).rows as unknown as Array<Record<string, unknown>>;
    if (earlier.some((r) => sourceOf(String(r.source), sourceType) !== null)) return null;
    reasons.push(earlier.length === 0 ? `${sourceType} was never asked these words` : `${sourceType} has no terms of use written down for its source`);
  }
  return reasons.length ? reasons.join('; ') : 'it names no source';
}
