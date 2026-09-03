// =============================================================================
// FOUNDRY - turning a real look into evidence
//
// The adapters fetch. This decides what a fetch MEANS, and it does so before
// the fetch happens.
//
// THE RULE IS STATED FIRST, WHICH IS THE WHOLE POINT. A question names what
// result would support the claim and what would contradict it, and only then
// does anybody look. Grading evidence after seeing it is how a research
// function becomes a justification engine — the same reason an experiment's
// prediction is sealed before it runs.
//
// AND LOOKING RAISES WHAT LOOKING CANNOT SETTLE. Every use of a source files
// the questions that source cannot answer, with what would answer them. So a
// candidate that has been researched carries both what was found and the shape
// of what is still dark, and nobody can mistake "I looked" for "I know".
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { observe, raiseUnknown } from '../market-evidence.js';
import {
  CAN_SEE as COMMUNITY_CAN_SEE, CANNOT_SEE as COMMUNITY_CANNOT_SEE,
  WOULD_MOST_HELP as COMMUNITY_WOULD_HELP, whatPeopleSaid,
} from './community.js';
import { relevanceOf } from './npm-registry.js';
import {
  CANNOT_TELL_US, downloadsLastMonth, packageRecord, whatAlreadyExists,
} from './npm-registry.js';

/**
 * WHAT THE SOURCE RETURNED, KEPT BEFORE ANYBODY JUDGED IT.
 *
 * The record that makes the three transitions inspectable: what came back, what
 * was judged relevant and on what words, and only then what a claim may rest
 * on. The rejected items are the important half - they are how somebody checks
 * that the relevance judgement was reasonable rather than convenient.
 */
async function recordRetrieval(input: {
  founderId: string; sourceType: string; source: string; terms: string;
  returnedCount: number; canSee: string; cannotSee: string; wouldMostHelp: string;
  notAlsoTried: string[] | null; evidenceMode: 'real' | 'sandbox' | 'reference';
  items: Array<{
    label: string; url: string | null; datedAt: string | null; said: string | null;
    relevant: boolean; sharedTerms: string[];
  }>;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO market_retrievals
       (id, founder_id, source_type, source, terms, returned_count, examined_count,
        relevant_count, can_see, cannot_see, not_also_tried, would_most_help, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.sourceType, input.source, input.terms,
      input.returnedCount, input.items.length,
      input.items.filter((i) => i.relevant).length,
      input.canSee, input.cannotSee,
      input.notAlsoTried === null || input.notAlsoTried.length === 0
        ? null : input.notAlsoTried.join(', '),
      input.wouldMostHelp, input.evidenceMode]);
  for (const item of input.items) {
    await query(
      `INSERT INTO retrieval_items
         (id, retrieval_id, founder_id, label, url, dated_at, said, relevant, shared_terms)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [nanoid(), id, input.founderId, item.label, item.url, item.datedAt, item.said,
        item.relevant ? 1 : 0,
        item.sharedTerms.length === 0 ? null : item.sharedTerms.join(', ')]);
  }
  return id;
}

export type SubstituteExpectation = 'nothing_maintained_exists' | 'something_maintained_exists';

export interface SubstituteQuestion {
  founderId: string;
  claimId: string;
  /** What is being looked for, in the words somebody would search with. */
  query: string;
  /**
   * Stated BEFORE looking: which finding would support the claim. The other
   * finding contradicts it. There is no third option, and that is deliberate —
   * a question whose every answer confirms the claim is not a question.
   */
  supportsIf: SubstituteExpectation;
  /** The candidate this bears on, so its unknowns land somewhere. */
  opportunityId?: string | null;
  /**
   * WHAT THIS MIGHT HAVE BEEN CALLED INSTEAD, and was not searched for.
   *
   * Only meaningful on a negative finding, and there it is most of the answer:
   * "nothing turned up" is worth very little without knowing which words were
   * not tried. An empty list is a real answer - it says nobody thought of any.
   */
  alsoCouldBeCalled?: string[];
}

export interface SubstituteFinding {
  /** Maintained AND actually about the thing searched for. The real answer. */
  maintained: number;
  /** How many were looked at, relevant or not. */
  looked: number;
  /** How many of those were about the thing at all. */
  relevant: number;
  /** The registry's own count of anything sharing the words. Not substitutes. */
  matchedWords: number;
  bearing: 'supports' | 'contradicts';
  /** One sentence, in the owner's language. */
  sentence: string;
  /** The strongest few, named, so the claim can be checked rather than trusted. */
  named: Array<{ name: string; url: string; lastPublished: string | null; maintained: boolean }>;
  /** What the source returned, kept whole, so the judgement can be inspected. */
  retrievalId: string;
}

/**
 * DOES A SOLUTION TO THIS ALREADY EXIST?
 *
 * The first question real evidence has ever answered in this institution.
 */
export async function askWhatAlreadyExists(
  q: SubstituteQuestion,
): Promise<SubstituteFinding> {
  const search = await whatAlreadyExists(q.query, 15);
  // RELEVANT FIRST, MAINTAINED SECOND. A registry's ranking is about
  // popularity, not about whether a result is on the subject at all, and
  // counting its top results as substitutes is how a search becomes a false
  // finding with a real URL under it.
  const relevant = search.found.filter((f) => f.relevant);
  const maintained = relevant.filter((f) => f.maintained);

  const bearing: 'supports' | 'contradicts' =
    (maintained.length === 0) === (q.supportsIf === 'nothing_maintained_exists')
      ? 'supports' : 'contradicts';

  const sentence = maintained.length === 0
    ? `Nothing maintained and on the subject turned up for "${q.query}". The registry `
      + `returned ${String(search.found.length)} results and `
      + `${relevant.length === 0
        ? 'none of them is about this — a keyword search is a weak instrument, and '
          + 'something solving it under other words would not show up here'
        : `${String(relevant.length)} of them are about this, none published to in `
          + 'eighteen months'}.`
    : `${String(maintained.length)} maintained ${maintained.length === 1 ? 'package' : 'packages'} `
      + `already ${maintained.length === 1 ? 'exists' : 'exist'} for "${q.query}" — `
      + `${maintained.slice(0, 3).map((m) => m.name).join(', ')}`
      + `${maintained.length > 3 ? ', among others' : ''}.`;

  // THE RETRIEVAL FIRST, so every observation carries where it came from at
  // birth. Provenance that could be attached afterwards would be provenance
  // that could be changed afterwards.
  const retrievalId = await recordRetrieval({
    founderId: q.founderId, sourceType: 'directory', source: search.url,
    terms: q.query, returnedCount: search.total,
    canSee: 'published packages: that one exists, when it was last published, how '
      + 'many versions it has, and what its publisher says it is for',
    cannotSee: 'whether anybody pays, whether downloads are people or build machines, '
      + 'whether an existing package is any good, and anything solving the problem '
      + 'that is not a published package',
    wouldMostHelp: maintained.length === 0
      ? 'people talking about the problem — a keyword search over package names cannot '
        + 'find a thing described in other words, and a discussion can'
      : 'reviews or issues on the packages that do exist — existing is not the same '
        + 'as good enough',
    notAlsoTried: q.alsoCouldBeCalled ?? null, evidenceMode: 'real',
    items: search.found.map((f) => ({
      label: f.name, url: f.url, datedAt: f.lastPublished, said: f.description,
      relevant: f.relevant, sharedTerms: f.shared,
    })),
  });
  const fromAbsence = maintained.length === 0;

  // THE DIRECTORY LISTING: what the registry observed, filed as such.
  await observe({
    retrievalId, fromAbsence,
    founderId: q.founderId, claimId: q.claimId, sourceType: 'directory',
    source: search.url, saw: sentence, bearing,
    // The count is worked out from what was listed, not stated by anybody.
    directness: 'inferred', observedAt: search.observedAt, evidenceMode: 'real',
  });

  // AND EACH MAINTAINED ONE, NAMED, so the finding can be checked. Its own
  // description is the publisher talking about itself and is filed as that.
  for (const found of maintained.slice(0, 5)) {
    await observe({
      retrievalId, fromAbsence: false,
      founderId: q.founderId, claimId: q.claimId, sourceType: 'vendor_site',
      source: found.url,
      saw: `${found.name}, last published ${found.lastPublished?.slice(0, 10) ?? 'unknown'}`
        + `${found.description ? `: "${found.description.slice(0, 160)}"` : ''}`
        + ` (shares: ${found.shared.join(', ')})`,
      bearing, directness: 'direct', observedAt: search.observedAt, evidenceMode: 'real',
    });
  }

  await raiseWhatItCannotSettle(q.founderId, q.opportunityId ?? null, q.claimId);

  return {
    maintained: maintained.length, looked: search.found.length,
    relevant: relevant.length, matchedWords: search.total, bearing, sentence,
    retrievalId,
    named: maintained.slice(0, 5).map((m) => ({
      name: m.name, url: m.url, lastPublished: m.lastPublished, maintained: m.maintained,
    })),
  };
}

/**
 * HOW USED IS THE THING THAT ALREADY EXISTS?
 *
 * A number from a system of record, filed as one — and immediately qualified,
 * because a download is not a customer and the source cannot tell us which of
 * these were machines.
 */
export async function askHowUsed(input: {
  founderId: string; claimId: string; packageName: string;
  supportsIf: 'few_downloads' | 'many_downloads'; fewMeans?: number;
  opportunityId?: string | null;
}): Promise<{ downloads: number | null; bearing: 'supports' | 'contradicts'; sentence: string }> {
  const few = input.fewMeans ?? 1_000;
  const count = await downloadsLastMonth(input.packageName);
  if (count === null) {
    return { downloads: null, bearing: 'contradicts',
      sentence: `The registry has no download figures for ${input.packageName}.` };
  }
  const isFew = count.downloads < few;
  const bearing: 'supports' | 'contradicts' =
    isFew === (input.supportsIf === 'few_downloads') ? 'supports' : 'contradicts';
  const sentence = `${input.packageName} was downloaded `
    + `${count.downloads.toLocaleString('en-US')} times between ${count.from} and ${count.to}. `
    + 'That counts machines as well as people.';

  await observe({
    founderId: input.founderId, claimId: input.claimId, sourceType: 'provider_api',
    source: count.url, saw: sentence, bearing, directness: 'direct',
    observedAt: count.observedAt, evidenceMode: 'real',
  });
  await raiseWhatItCannotSettle(input.founderId, input.opportunityId ?? null, input.claimId);
  return { downloads: count.downloads, bearing, sentence };
}

/** Is anybody still there? The registry's own record, not the publisher's word. */
export async function askWhetherMaintained(input: {
  founderId: string; claimId: string; packageName: string;
  supportsIf: 'abandoned' | 'maintained'; opportunityId?: string | null;
}): Promise<{ sentence: string; bearing: 'supports' | 'contradicts' } | null> {
  const record = await packageRecord(input.packageName);
  if (record === null) return null;
  const age = record.lastPublished === null ? Infinity
    : (Date.now() - new Date(record.lastPublished).getTime()) / 86_400_000;
  const abandoned = !(age <= 548);
  const bearing: 'supports' | 'contradicts' =
    abandoned === (input.supportsIf === 'abandoned') ? 'supports' : 'contradicts';
  const sentence = `${record.name} was last published `
    + `${record.lastPublished?.slice(0, 10) ?? 'never'}`
    + `${abandoned ? ', which is more than eighteen months ago' : ''}`
    + `, across ${String(record.versionCount)} versions and `
    + `${String(record.maintainerCount)} maintainer(s).`;

  await observe({
    founderId: input.founderId, claimId: input.claimId, sourceType: 'directory',
    source: record.url, saw: sentence, bearing, directness: 'direct',
    observedAt: record.observedAt, evidenceMode: 'real',
  });
  await raiseWhatItCannotSettle(input.founderId, input.opportunityId ?? null, input.claimId);
  return { sentence, bearing };
}

export interface PainQuestion {
  founderId: string;
  claimId: string;
  terms: string;
  /**
   * Stated before looking. A claim that people find this painful is supported
   * by people describing the pain, and contradicted by nobody mentioning it.
   */
  supportsIf: 'people_describe_the_pain' | 'nobody_mentions_it';
  opportunityId?: string | null;
  alsoCouldBeCalled?: string[];
}

export interface PainFinding {
  /** People who wrote something actually about the subject. Not the raw count. */
  said: number;
  bearing: 'supports' | 'contradicts';
  sentence: string;
  /** A few of the actual words, so the finding is readable rather than counted. */
  voices: Array<{ text: string; url: string; saidAt: string | null }>;
  retrievalId: string;
}

/**
 * WHAT DO PEOPLE ACTUALLY SAY ABOUT THIS?
 *
 * The second way of knowing, and it answers a question a registry structurally
 * cannot: not what exists, but what hurts. The two disagreeing is the useful
 * case - a well-served problem where people are still complaining is not a
 * dead thesis, it is a narrower one.
 *
 * RECENCY IS PART OF THE FINDING. A complaint from 2014 about a tool that has
 * been rewritten twice since is a fact about 2014. So how recent the talk is
 * travels with the count, rather than being averaged into it.
 */
export async function askWhatPeopleSay(q: PainQuestion): Promise<PainFinding> {
  const talk = await whatPeopleSaid(q.terms, 15);

  // RETRIEVAL IS NOT RELEVANCE HERE EITHER, and an earlier comment in this file
  // claimed otherwise — that an archive searching free text returns only things
  // on the subject "by construction". Running it proved that false in one go:
  // asked about cron expression parsers, it returned somebody describing a
  // constructed language they had built with a sibling. Same lesson as the
  // registry, a different instrument, and worth learning once.
  const onSubject = talk.found.filter((s) => relevanceOf(q.terms, '', s.text).relevant);
  const recent = onSubject.filter((s) => {
    if (s.saidAt === null) return false;
    const years = (Date.now() - new Date(s.saidAt).getTime()) / (365 * 86_400_000);
    return Number.isFinite(years) && years <= 3;
  });

  const anyone = onSubject.length > 0;
  const bearing: 'supports' | 'contradicts' =
    anyone === (q.supportsIf === 'people_describe_the_pain') ? 'supports' : 'contradicts';

  const sentence = !anyone
    ? `Nobody in the archive has discussed "${q.terms}"`
      + `${talk.found.length > 0
        ? ` — ${String(talk.found.length)} things came back and none of them is about this`
        : ''}. That is not silence about the problem — it is silence in one place `
      + 'where technical people talk.'
    : `${String(onSubject.length)} people have written about "${q.terms}", `
      + `${recent.length === 0
        ? 'none of them in the last three years, so this is talk about how things used to be'
        : `${String(recent.length)} of them in the last three years`}.`;

  const retrievalId = await recordRetrieval({
    founderId: q.founderId, sourceType: 'community', source: talk.url,
    terms: q.terms, returnedCount: talk.total,
    canSee: COMMUNITY_CAN_SEE, cannotSee: COMMUNITY_CANNOT_SEE,
    wouldMostHelp: COMMUNITY_WOULD_HELP,
    notAlsoTried: q.alsoCouldBeCalled ?? null, evidenceMode: 'real',
    items: talk.found.map((s) => ({
      label: s.text.slice(0, 90), url: s.url, datedAt: s.saidAt,
      said: s.text.slice(0, 500),
      relevant: onSubject.includes(s),
      sharedTerms: relevanceOf(q.terms, '', s.text).shared,
    })),
  });

  await observe({
    retrievalId, fromAbsence: !anyone,
    founderId: q.founderId, claimId: q.claimId, sourceType: 'community',
    source: talk.url, saw: sentence, bearing,
    // A count of complaints is worked out from what was said, not stated.
    directness: 'inferred', observedAt: talk.observedAt, evidenceMode: 'real',
  });
  // AND THE WORDS THEMSELVES, because "eleven people complained" is a number
  // and "the timezones are what actually break" is a finding.
  for (const voice of recent.slice(0, 4)) {
    await observe({
      retrievalId, fromAbsence: false,
      founderId: q.founderId, claimId: q.claimId, sourceType: 'community',
      source: voice.url, saw: voice.text.slice(0, 500), bearing,
      directness: 'direct', observedAt: new Date(voice.saidAt ?? talk.observedAt),
      evidenceMode: 'real',
    });
  }

  await raiseWhatItCannotSettle(q.founderId, q.opportunityId ?? null, q.claimId);

  return {
    said: onSubject.length, bearing, sentence, retrievalId,
    voices: recent.slice(0, 4).map((v) => ({ text: v.text, url: v.url, saidAt: v.saidAt })),
  };
}

/**
 * USING A SOURCE RAISES WHAT IT CANNOT SETTLE.
 *
 * Idempotent by the question text, so looking twice does not accumulate the
 * same doubt twice — but looking once is enough to put it on the record.
 */
async function raiseWhatItCannotSettle(
  founderId: string, opportunityId: string | null, claimId: string,
): Promise<void> {
  for (const gap of CANNOT_TELL_US) {
    const already = (await query(
      `SELECT id FROM market_unknowns
        WHERE founder_id = ? AND question = ? AND answered_at IS NULL
          AND (opportunity_id IS ? OR claim_id = ?)`,
      [founderId, gap.question, opportunityId, claimId])).rows[0];
    if (already) continue;
    await raiseUnknown({
      founderId, opportunityId, claimId, question: gap.question,
      // Not blocking on its own: these are the shape of what one source cannot
      // see, not a verdict on the candidate. What blocks is decided by the
      // candidate discipline, which reads them alongside everything else.
      blocking: false, cheapestTest: gap.wouldNeed,
    });
  }
}
