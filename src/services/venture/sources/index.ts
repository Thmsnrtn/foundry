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

import { query } from '../../../db/client.js';
import { observe, raiseUnknown } from '../market-evidence.js';
import {
  CANNOT_TELL_US, downloadsLastMonth, packageRecord, whatAlreadyExists,
} from './npm-registry.js';

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

  // THE DIRECTORY LISTING: what the registry observed, filed as such.
  await observe({
    founderId: q.founderId, claimId: q.claimId, sourceType: 'directory',
    source: search.url, saw: sentence, bearing,
    // The count is worked out from what was listed, not stated by anybody.
    directness: 'inferred', observedAt: search.observedAt, evidenceMode: 'real',
  });

  // AND EACH MAINTAINED ONE, NAMED, so the finding can be checked. Its own
  // description is the publisher talking about itself and is filed as that.
  for (const found of maintained.slice(0, 5)) {
    await observe({
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
