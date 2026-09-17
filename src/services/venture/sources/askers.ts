// =============================================================================
// FOUNDRY - every eye, asked the question it can answer
//
// Weeding used to ask one instrument - the package registry - and the frontier
// stayed starved: a seed needs two genuinely different ways of knowing to
// become a candidate, and one registry is one way however often it is read.
//
// This is the registry of ASKERS. Each is bound to a source type, and through
// it to the one epistemic stance that kind of source supplies (migration 253:
// derived from the type, never declared by the caller, so nobody can
// manufacture independence). Each asks its source the question that source
// can answer - not the seed's question - forms a claim for that question,
// keeps what came back whole, writes the observations under the right source
// type, raises what the instrument cannot see, and says in one sentence what
// it found. What the finding BEARS on the seed is decided elsewhere, from the
// constitutional bearings table, and a missing row means it bears nothing.
//
// Reachable is read from the provider registry: a provider that has stopped
// answering (degraded, unavailable) is not asked, and a declared one is - it
// is proven by being used.
// =============================================================================
import { query } from '../../../db/client.js';
import { formClaim, observe } from '../market-evidence.js';
import { relevanceOf } from './npm-registry.js';
import { recordRetrieval, raiseWhatItCannotSettle, askWhatAlreadyExists, askWhatPeopleSay } from './index.js';

export interface Asked {
  /** The provider that answered. */
  provider: string;
  sourceType: string;
  stance: string;
  /** What was asked, in words the record can carry. */
  asked: string;
  found: 'found' | 'empty';
  sentence: string;
  claimId: string;
}

export interface AskerInput {
  founderId: string; seedId: string; seed: string; words: string; opportunityId?: string | null;
}

export interface Asker {
  provider: string;
  sourceType: string;
  stance: string;
  /** The question, in the words the record carries, before it is asked. The
   *  same words asked of the same eye is the same question, and is not asked twice. */
  question(words: string): string;
  ask(input: AskerInput): Promise<Asked>;
}

/** The claim a source's question rests on, formed once per seed and question. */
async function claimFor(input: AskerInput, claim: string): Promise<string> {
  const existing = (await query(
    'SELECT id FROM market_claims WHERE seed_id = ? AND claim = ? LIMIT 1',
    [input.seedId, claim])).rows[0] as Record<string, unknown> | undefined;
  if (existing) return String(existing.id);
  return formClaim({ founderId: input.founderId, seedId: input.seedId, evidenceMode: 'real', claim });
}

// ─── substitute ──────────────────────────────────────────────────────────────

const npmRegistry: Asker = {
  provider: 'npm_registry', sourceType: 'directory', stance: 'substitute',
  question: (words) => `whether anything maintained already does it, searching "${words}"`,
  async ask(input) {
    const claim = `nothing maintained already does this: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const found = await askWhatAlreadyExists({
      founderId: input.founderId, claimId, query: input.words, supportsIf: 'nothing_maintained_exists',
      opportunityId: input.opportunityId ?? null,
    });
    return {
      provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: found.relevant === 0 ? 'empty' : 'found', sentence: found.sentence,
    };
  },
};

const appleAppStore: Asker = {
  provider: 'apple_app_store', sourceType: 'app_store', stance: 'substitute',
  question: (words) => `whether a maintained app already does it, searching the App Store for "${words}"`,
  async ask(input) {
    const { whatAppsExist, CAN_SEE, CANNOT_SEE, WOULD_MOST_HELP, CANNOT_TELL_US } = await import('./app-store.js');
    const claim = `no maintained app already does this: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const search = await whatAppsExist(input.words, 10);
    const relevant = search.found.filter((a) => a.relevant);
    const maintained = relevant.filter((a) => a.maintained);
    const sentence = maintained.length === 0
      ? `No maintained app on the subject turned up for "${input.words}": ${String(search.found.length)} came back`
        + `${relevant.length === 0 ? ' and none is about this' : ` and the ${String(relevant.length)} about it have not been updated in eighteen months`}.`
      : `${String(maintained.length)} maintained app(s) already address "${input.words}": `
        + maintained.slice(0, 3).map((a) => `${a.name}${a.rating !== null ? ` (${a.rating.toFixed(1)} from ${String(a.ratingCount)} ratings)` : ''}`).join(', ') + '.';
    const retrievalId = await recordRetrieval({
      founderId: input.founderId, sourceType: 'app_store', source: search.url, terms: input.words,
      returnedCount: search.total, canSee: CAN_SEE, cannotSee: CANNOT_SEE, wouldMostHelp: WOULD_MOST_HELP,
      notAlsoTried: null, evidenceMode: 'real',
      items: search.found.map((a) => ({
        label: a.name, url: a.url, datedAt: a.lastUpdated, said: a.description, relevant: a.relevant, sharedTerms: a.shared,
      })),
    });
    await observe({
      retrievalId, fromAbsence: maintained.length === 0,
      founderId: input.founderId, claimId, sourceType: 'app_store', source: search.url, saw: sentence,
      bearing: maintained.length === 0 ? 'supports' : 'contradicts', directness: 'direct',
      observedAt: search.observedAt, evidenceMode: 'real',
    });
    await raiseWhatItCannotSettle(input.founderId, input.opportunityId ?? null, claimId, CANNOT_TELL_US);
    return {
      provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: relevant.length === 0 ? 'empty' : 'found', sentence,
    };
  },
};

// ─── satisfaction ────────────────────────────────────────────────────────────

const appleReviews: Asker = {
  provider: 'apple_app_reviews', sourceType: 'review', stance: 'satisfaction',
  question: (words) => `what users of an existing app for "${words}" say fails, reading its most recent reviews`,
  async ask(input) {
    const { whatAppsExist, whatUsersSay, CAN_SEE, CANNOT_SEE, WOULD_MOST_HELP, CANNOT_TELL_US } = await import('./app-store.js');
    const claim = `people who use what exists for this say what fails in it: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const search = await whatAppsExist(input.words, 5);
    const top = search.found.filter((a) => a.relevant).sort((a, b) => b.ratingCount - a.ratingCount)[0];
    if (!top) {
      const sentence = `No app on the subject of "${input.words}" exists to have reviews, so nobody has said what fails.`;
      await observe({ fromAbsence: true, founderId: input.founderId, claimId, sourceType: 'review', source: search.url,
        saw: sentence, bearing: 'contradicts', directness: 'inferred', observedAt: search.observedAt, evidenceMode: 'real' });
      return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
        asked: this.question(input.words), found: 'empty', sentence };
    }
    const reviews = await whatUsersSay(top.id, 20);
    // A complaint is a review with a low rating that says something. Praise is
    // not a finding about a gap.
    const complaints = reviews.found.filter((r) => r.rating !== null && r.rating <= 3 && r.text.length > 20);
    const onSubject = complaints.filter((r) => relevanceOf(input.words, r.title, r.text).relevant || complaints.length <= 3);
    const sentence = complaints.length === 0
      ? `${top.name} has ${String(reviews.found.length)} recent reviews and none of them complains, which says nothing about what is missing.`
      : `${String(complaints.length)} of ${top.name}'s ${String(reviews.found.length)} recent reviews complain; `
        + `the most recent: "${complaints[0]!.text.slice(0, 160)}".`;
    const retrievalId = await recordRetrieval({
      founderId: input.founderId, sourceType: 'review', source: reviews.url, terms: input.words,
      returnedCount: reviews.found.length, canSee: CAN_SEE, cannotSee: CANNOT_SEE, wouldMostHelp: WOULD_MOST_HELP,
      notAlsoTried: null, evidenceMode: 'real',
      items: reviews.found.map((r) => ({
        label: `${r.rating !== null ? `${String(r.rating)}/5 ` : ''}${r.title}`.slice(0, 90), url: r.url, datedAt: r.saidAt,
        said: r.text.slice(0, 500), relevant: complaints.includes(r), sharedTerms: relevanceOf(input.words, r.title, r.text).shared,
      })),
    });
    await observe({
      retrievalId, fromAbsence: complaints.length === 0,
      founderId: input.founderId, claimId, sourceType: 'review', source: reviews.url, saw: sentence,
      bearing: complaints.length === 0 ? 'contradicts' : 'supports', directness: 'inferred',
      observedAt: reviews.observedAt, evidenceMode: 'real',
    });
    for (const voice of onSubject.slice(0, 3)) {
      await observe({
        retrievalId, fromAbsence: false, founderId: input.founderId, claimId, sourceType: 'review', source: voice.url,
        saw: voice.text.slice(0, 500), bearing: 'supports', directness: 'direct',
        observedAt: new Date(voice.saidAt ?? reviews.observedAt), evidenceMode: 'real',
      });
    }
    await raiseWhatItCannotSettle(input.founderId, input.opportunityId ?? null, claimId, CANNOT_TELL_US);
    return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: complaints.length === 0 ? 'empty' : 'found', sentence };
  },
};

// ─── problem_pain ────────────────────────────────────────────────────────────

const hnCommunity: Asker = {
  provider: 'hn_algolia', sourceType: 'community', stance: 'problem_pain',
  question: (words) => `whether people describe the pain, searching public discussion for "${words}"`,
  async ask(input) {
    const claim = `people describe this as costing them time or money: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const found = await askWhatPeopleSay({
      founderId: input.founderId, claimId, terms: input.words, supportsIf: 'people_describe_the_pain',
      opportunityId: input.opportunityId ?? null,
    });
    return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: found.said === 0 ? 'empty' : 'found', sentence: found.sentence };
  },
};

const githubIssues: Asker = {
  provider: 'github_issues', sourceType: 'community', stance: 'problem_pain',
  question: (words) => `whether people report it broken or missing, searching public issue trackers for "${words}"`,
  async ask(input) {
    const { whatIsReportedBroken, CAN_SEE, CANNOT_SEE, WOULD_MOST_HELP } = await import('./issue-trackers.js');
    const claim = `people report this broken or missing in what they already use: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const issues = await whatIsReportedBroken(input.words, 10);
    const onSubject = issues.found.filter((s) => relevanceOf(input.words, '', s.text).relevant);
    const sentence = onSubject.length === 0
      ? `Nobody has reported "${input.words}" broken or missing on a public tracker`
        + `${issues.found.length > 0 ? ` — ${String(issues.found.length)} issues came back and none is about this` : ''}.`
      : `${String(onSubject.length)} public issue(s) report "${input.words}" broken or missing; the most reacted-to: "${onSubject[0]!.text.slice(0, 140)}".`;
    const retrievalId = await recordRetrieval({
      founderId: input.founderId, sourceType: 'community', source: issues.url, terms: input.words,
      returnedCount: issues.total, canSee: CAN_SEE, cannotSee: CANNOT_SEE, wouldMostHelp: WOULD_MOST_HELP,
      notAlsoTried: null, evidenceMode: 'real',
      items: issues.found.map((s) => ({
        label: s.text.slice(0, 90), url: s.url, datedAt: s.saidAt, said: s.text.slice(0, 500),
        relevant: onSubject.includes(s), sharedTerms: relevanceOf(input.words, '', s.text).shared,
      })),
    });
    await observe({
      retrievalId, fromAbsence: onSubject.length === 0, founderId: input.founderId, claimId, sourceType: 'community',
      source: issues.url, saw: sentence, bearing: onSubject.length === 0 ? 'contradicts' : 'supports',
      directness: 'inferred', observedAt: issues.observedAt, evidenceMode: 'real',
    });
    for (const voice of onSubject.slice(0, 3)) {
      await observe({
        retrievalId, fromAbsence: false, founderId: input.founderId, claimId, sourceType: 'community', source: voice.url,
        saw: voice.text.slice(0, 500), bearing: 'supports', directness: 'direct',
        observedAt: new Date(voice.saidAt ?? issues.observedAt), evidenceMode: 'real',
      });
    }
    return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: onSubject.length === 0 ? 'empty' : 'found', sentence };
  },
};

// ─── demand_signal ───────────────────────────────────────────────────────────

const searchDemand: Asker = {
  provider: 'duckduckgo_autocomplete', sourceType: 'search_evidence', stance: 'demand_signal',
  question: (words) => `whether people look for it by name, asking a search box to complete "${words}"`,
  async ask(input) {
    const { whatPeopleSearchFor, CAN_SEE, CANNOT_SEE, WOULD_MOST_HELP, CANNOT_TELL_US } = await import('./search-demand.js');
    const claim = `people look for this by name: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const demand = await whatPeopleSearchFor(input.words);
    const relevant = demand.found.filter((c) => c.relevant);
    const sentence = relevant.length === 0
      ? `Nobody completes a search for "${input.words}"; the search box offers nothing on the subject.`
      : `People search for "${input.words}": ${String(relevant.length)} completion(s)`
        + `${demand.wanted.length ? `, and the words they add are ${demand.wanted.slice(0, 4).map((w) => `"${w.word}"`).join(', ')}` : ''}.`;
    const retrievalId = await recordRetrieval({
      founderId: input.founderId, sourceType: 'search_evidence', source: demand.url, terms: input.words,
      returnedCount: demand.found.length, canSee: CAN_SEE, cannotSee: CANNOT_SEE, wouldMostHelp: WOULD_MOST_HELP,
      notAlsoTried: null, evidenceMode: 'real',
      items: demand.found.map((c) => ({ label: c.text.slice(0, 90), url: null, datedAt: null, said: null, relevant: c.relevant, sharedTerms: c.shared })),
    });
    await observe({
      retrievalId, fromAbsence: relevant.length === 0, founderId: input.founderId, claimId, sourceType: 'search_evidence',
      source: demand.url, saw: sentence, bearing: relevant.length === 0 ? 'contradicts' : 'supports',
      directness: 'direct', observedAt: demand.observedAt, evidenceMode: 'real',
    });
    await raiseWhatItCannotSettle(input.founderId, input.opportunityId ?? null, claimId, CANNOT_TELL_US);
    return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: relevant.length === 0 ? 'empty' : 'found', sentence };
  },
};

// ─── procurement_labour ──────────────────────────────────────────────────────

const remotiveJobs: Asker = {
  provider: 'remotive', sourceType: 'job_posting', stance: 'procurement_labour',
  question: (words) => `whether an organisation pays somebody for it, searching a public jobs board for "${words}"`,
  async ask(input) {
    const { whoIsHiringFor, CAN_SEE, CANNOT_SEE, WOULD_MOST_HELP, CANNOT_TELL_US } = await import('./job-postings.js');
    const claim = `an organisation pays somebody to do this work: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const hiring = await whoIsHiringFor(input.words, 20);
    const relevant = hiring.found.filter((p) => p.relevant);
    const sentence = relevant.length === 0
      ? `No organisation is advertising, on this board, to pay somebody for "${input.words}"`
        + `${hiring.found.length > 0 ? ` — ${String(hiring.found.length)} postings came back and none is about it` : ''}.`
      : `${String(relevant.length)} organisation(s) are paying people for "${input.words}": `
        + relevant.slice(0, 3).map((p) => `${p.company} (${p.title}${p.salary ? `, ${p.salary}` : ''})`).join('; ') + '.';
    const retrievalId = await recordRetrieval({
      founderId: input.founderId, sourceType: 'job_posting', source: hiring.url, terms: input.words,
      returnedCount: hiring.total, canSee: CAN_SEE, cannotSee: CANNOT_SEE, wouldMostHelp: WOULD_MOST_HELP,
      notAlsoTried: null, evidenceMode: 'real',
      items: hiring.found.map((p) => ({
        label: `${p.company}: ${p.title}`.slice(0, 90), url: p.url, datedAt: p.postedAt, said: p.excerpt.slice(0, 500),
        relevant: p.relevant, sharedTerms: p.shared,
      })),
    });
    await observe({
      retrievalId, fromAbsence: relevant.length === 0, founderId: input.founderId, claimId, sourceType: 'job_posting',
      source: hiring.url, saw: sentence, bearing: relevant.length === 0 ? 'contradicts' : 'supports',
      directness: 'direct', observedAt: hiring.observedAt, evidenceMode: 'real',
    });
    await raiseWhatItCannotSettle(input.founderId, input.opportunityId ?? null, claimId, CANNOT_TELL_US);
    return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: relevant.length === 0 ? 'empty' : 'found', sentence };
  },
};

// ─── usage ───────────────────────────────────────────────────────────────────

const wikipediaPageviews: Asker = {
  provider: 'wikipedia_pageviews', sourceType: 'public_dataset', stance: 'usage',
  question: (words) => `how often it is looked up by name, reading encyclopedia pageviews for "${words}"`,
  async ask(input) {
    const { howOftenLookedUp, CAN_SEE, CANNOT_SEE, WOULD_MOST_HELP } = await import('./pageviews.js');
    const claim = `enough people look this up for it to have measured attention: ${input.seed}`;
    const claimId = await claimFor(input, claim);
    const looked = await howOftenLookedUp(input.words);
    const total = looked.months.reduce((n, m) => n + m.views, 0);
    const sentence = looked.article === null
      ? `Nothing in the encyclopedia is on the subject of "${input.words}", so there is no count to read.`
      : `"${looked.article}" was looked up ${total.toLocaleString('en-US')} times over ${String(looked.months.length)} month(s)`
        + `${looked.months.length ? ` (${looked.months.map((m) => `${m.month}: ${m.views.toLocaleString('en-US')}`).join(', ')})` : ''}. That counts readers, not people with the problem.`;
    const retrievalId = await recordRetrieval({
      founderId: input.founderId, sourceType: 'public_dataset', source: looked.url, terms: input.words,
      returnedCount: looked.months.length, canSee: CAN_SEE, cannotSee: CANNOT_SEE, wouldMostHelp: WOULD_MOST_HELP,
      notAlsoTried: null, evidenceMode: 'real',
      items: looked.article === null ? [] : [{ label: looked.article, url: looked.url, datedAt: null, said: sentence.slice(0, 500), relevant: true, sharedTerms: relevanceOf(input.words, looked.article, null).shared }],
    });
    await observe({
      retrievalId, fromAbsence: looked.article === null, founderId: input.founderId, claimId, sourceType: 'public_dataset',
      source: looked.url, saw: sentence, bearing: looked.article === null || total === 0 ? 'contradicts' : 'supports',
      directness: 'direct', observedAt: looked.observedAt, evidenceMode: 'real',
    });
    return { provider: this.provider, sourceType: this.sourceType, stance: this.stance, claimId,
      asked: this.question(input.words),
      found: looked.article === null || total === 0 ? 'empty' : 'found', sentence };
  },
};

const ASKERS: Asker[] = [npmRegistry, appleAppStore, appleReviews, hnCommunity, githubIssues, searchDemand, remotiveJobs, wikipediaPageviews];

/**
 * THE ASKERS FOUNDRY CAN REACH FOR THESE STANCES, in registry order. A provider
 * the sense check has found broken is left out; a declared one is included,
 * because it is proven by being used.
 */
export async function askersFor(stances: string[], world: 'real' | 'reference' = 'real'): Promise<Asker[]> {
  if (world === 'reference' || stances.length === 0) return [];
  const reachable = new Set(((await query(
    `SELECT p.provider FROM capability_providers p
      WHERE p.supplies_source_type IS NOT NULL AND p.maturity NOT IN ('unavailable','degraded')`, []))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.provider)));
  const wanted = new Set(stances);
  return ASKERS.filter((a) => wanted.has(a.stance) && reachable.has(a.provider))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => stances.indexOf(x.a.stance) - stances.indexOf(y.a.stance) || x.i - y.i)
    .map((x) => x.a);
}

/** Every asker this file knows, for the sense check and the record. */
export function everyAsker(): ReadonlyArray<Pick<Asker, 'provider' | 'sourceType' | 'stance'>> {
  return ASKERS.map(({ provider, sourceType, stance }) => ({ provider, sourceType, stance }));
}
