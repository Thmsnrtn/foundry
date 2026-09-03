// =============================================================================
// FOUNDRY - market knowledge, which is not a feed
//
// Stripe is a single coherent source of truth about one company: connect it and
// you know the revenue. Nothing is like that about a market. Knowledge there
// accumulates from many partial, dated, disagreeing sources, and what they
// produce together is a CLAIM with evidence on both sides and an honest
// statement of what is still unknown.
//
// SO A CLAIM'S STANDING IS DERIVED, NEVER ASSERTED. Nothing writes "confident"
// on a claim. What is stored is what was seen, where, when, and which way it
// cut; how the claim stands is computed from that, and it changes when a
// contradiction arrives - which is the behaviour that makes this a research
// institution rather than a justification engine.
//
// THE MODEL MAY REASON OVER EVIDENCE. ITS RECOLLECTION IS NOT EVIDENCE. There is
// no source type for "the model remembered this", and there will not be one.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type Bearing = 'supports' | 'contradicts';
export type Directness = 'direct' | 'inferred';

/** How old an observation may be before it is describing the past. */
const STALE_DAYS = 180;

export interface Standing {
  claimId: string;
  claim: string;
  supports: number;
  contradicts: number;
  /** Supporting observations that say the thing rather than imply it. */
  direct: number;
  /** How many of the supports are older than half a year. */
  stale: number;
  /** The kinds of source, because six vendor pages are not six kinds of evidence. */
  kindsOfSource: string[];
  /** Derived, in words. Never a number, and never the word "confident". */
  howItStands: string;
  settled: 'held' | 'failed' | null;
  /**
   * WHO SETTLED IT AND WHEN, shown wherever the settlement is.
   *
   * A claim that reads "this held" with nobody's name on it is an assertion
   * from the institution. Reality settled it, somebody decided that it had, and
   * both facts belong next to the verdict — the same standard applied to every
   * other consequential decision here.
   */
  settledBy: string | null;
  settledOn: string | null;
}

/**
 * HOW A CLAIM STANDS, FROM ITS EVIDENCE.
 *
 * The sentence is the product. "Four things support this and one contradicts it,
 * all from what companies say about themselves" is a different state from "four
 * support it across three kinds of source" - and an institution that reported
 * both as "well supported" would be hiding the thing the owner needs.
 */
export async function standingOf(claimId: string): Promise<Standing | null> {
  const claim = (await query(
    `SELECT id, claim, settled_as, settled_at, settled_by
       FROM market_claims WHERE id = ?`, [claimId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!claim) return null;

  const rows = (await query(
    `SELECT o.bearing, o.directness, o.source_type, t.stance,
            CAST(julianday('now') - julianday(o.observed_at) AS INTEGER) AS age
       FROM market_observations o
       JOIN market_source_types t ON t.source_type = o.source_type
      WHERE o.claim_id = ?`, [claimId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const supporting = rows.filter((r) => String(r.bearing) === 'supports');
  const against = rows.filter((r) => String(r.bearing) === 'contradicts');
  const direct = supporting.filter((r) => String(r.directness) === 'direct').length;
  const stale = supporting.filter((r) => Number(r.age) > STALE_DAYS).length;
  const kinds = [...new Set(supporting.map((r) => String(r.source_type)))];
  const stances = new Set(supporting.map((r) => String(r.stance)));

  // SETTLEMENT OUTRANKS ACCUMULATION, and says who and when. Once something
  // actually happened, describing the balance of evidence would be reporting
  // the argument after the result came in.
  const howItStands = ((): string => {
    if (claim.settled_as != null) {
      return `${String(claim.settled_as) === 'held' ? 'This held' : 'This did not hold'}`
        + ` - settled by ${String(claim.settled_by ?? 'nobody recorded')} on `
        + `${String(claim.settled_at ?? '').slice(0, 10)}.`;
    }
    if (rows.length === 0) return 'Nothing has been seen about this yet.';
    if (against.length > 0) {
      return `${String(supporting.length)} `
        + `${supporting.length === 1 ? 'thing supports' : 'things support'} this and `
        + `${String(against.length)} `
        + `${against.length === 1 ? 'contradicts' : 'contradict'} it. I am not going `
        + 'to average that into a verdict - it means the question is open, and what '
        + 'would settle it is worth more than another agreeing source.';
    }
    if (direct === 0) {
      return 'Everything supporting this was worked out rather than seen. Nothing '
        + 'has directly said it.';
    }
    // A vendor saying its own price is authoritative about price and worthless
    // about whether anyone pays it. Counting stances separately is what stops
    // six pricing pages reading as six independent confirmations.
    if (stances.size === 1 && stances.has('self_reported')) {
      return `${String(supporting.length)} sources support this and all of them are `
        + 'companies talking about themselves. That is good evidence about what '
        + 'they charge and no evidence at all about what anyone pays.';
    }
    if (stale === supporting.length && supporting.length > 0) {
      return `${String(supporting.length)} sources support this and all of them are `
        + 'more than six months old. That is evidence about last year.';
    }
    return `${String(direct)} of ${String(supporting.length)} supporting observations `
      + `say it directly, across ${String(kinds.length)} `
      + `${kinds.length === 1 ? 'kind' : 'kinds'} of source. Nothing contradicts it yet.`;
  })();

  return {
    claimId: String(claim.id), claim: String(claim.claim),
    supports: supporting.length, contradicts: against.length,
    direct, stale, kindsOfSource: kinds, howItStands,
    settled: claim.settled_as == null ? null : String(claim.settled_as) as 'held' | 'failed',
    settledBy: claim.settled_by == null ? null : String(claim.settled_by),
    settledOn: claim.settled_at == null ? null : String(claim.settled_at).slice(0, 10),
  };
}

export async function formClaim(input: {
  founderId: string; claim: string; opportunityId?: string | null;
  evidenceMode: 'real' | 'reference';
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO market_claims (id, founder_id, claim, opportunity_id, evidence_mode)
     VALUES (?,?,?,?,?)`,
    [id, input.founderId, input.claim.trim(), input.opportunityId ?? null,
      input.evidenceMode]);
  return id;
}

/**
 * File one thing somebody saw.
 *
 * `observedAt` is when it was TRUE, not when it was filed. A pricing page read a
 * year ago is evidence about last year, and a claim resting on stale
 * observations should say so rather than look current.
 */
export async function observe(input: {
  founderId: string; claimId: string; sourceType: string; source: string;
  saw: string; bearing: Bearing; directness: Directness;
  observedAt: Date; evidenceMode: 'real' | 'sandbox' | 'reference';
  /**
   * WHAT THE SOURCE RETURNED, at the moment this was judged out of it.
   *
   * Passed in at birth rather than attached later, and the immutability guard
   * is why: an observation whose provenance could be edited afterwards is an
   * observation whose provenance means nothing. The first version of the
   * retrieval work tried to back-patch this column and the trigger refused it,
   * which was the trigger being right.
   */
  retrievalId?: string | null;
  /**
   * True when this rests on nothing having been found. Absence is inferred from
   * what a particular instrument could see, and must never read as presence.
   */
  fromAbsence?: boolean;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO market_observations
       (id, founder_id, claim_id, source_type, source, saw, bearing, directness,
        observed_at, evidence_mode, retrieval_id, from_absence)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.claimId, input.sourceType, input.source.trim(),
      input.saw.trim(), input.bearing, input.directness,
      input.observedAt.toISOString(), input.evidenceMode,
      input.retrievalId ?? null, input.fromAbsence === true ? 1 : 0]);
  return id;
}

/**
 * REALITY SETTLES A CLAIM. EVIDENCE ACCUMULATING DOES NOT.
 *
 * Five supporting observations and no contradiction is a well-supported claim,
 * and it is still not a settled one — the difference is whether anything
 * actually happened. So this is deliberately separate from `standingOf`, which
 * can only ever describe what has been seen, and it takes a witness: a claim
 * that settled itself would be the institution marking its own paper.
 *
 * Once, and one way. A claim that could be re-settled would let a later
 * disappointment be edited into an earlier success.
 */
export async function settleClaim(input: {
  claimId: string; as: 'held' | 'failed'; by: string;
}): Promise<void> {
  await query(
    `UPDATE market_claims
        SET settled_as = ?, settled_at = datetime('now'), settled_by = ?
      WHERE id = ?`, [input.as, input.by, input.claimId]);
}

/**
 * HOW A CLAIM WAS RESEARCHED, COLLAPSED INTO JUDGMENT.
 *
 * The owner does not meet sources, crawling, or tool calls. He meets one
 * paragraph: how much was looked at, how many ways, what supports, what
 * weakens, what is still the largest unknown. Everything under it stays
 * inspectable for when he asks why — and that is the whole reason the
 * retrieval trail exists rather than being an audit table nobody opens.
 */
export interface HowItWasResearched {
  observations: number;
  sourceKinds: number;
  supports: number;
  contradicts: number;
  /** True when any of the support rests on nothing having been found. */
  restsOnAbsence: boolean;
  /** The one paragraph. */
  judgment: string;
  /** What weakens it, in the words that were actually written or listed. */
  whatContradicts: string[];
  /** How each look was made, so coverage can be judged rather than assumed. */
  coverage: Array<{
    sourceType: string; terms: string;
    /** What the source claimed to have, what was examined, what was on-subject. */
    had: number; examined: number; onSubject: number;
    canSee: string; cannotSee: string;
    notAlsoTried: string | null; wouldMostHelp: string;
    lookedAt: string;
    /** For "show me the evidence": everything it returned, believed or not. */
    retrievalId: string;
  }>;
  /** The biggest thing nobody knows, and the cheapest way to find out. */
  largestUnknown: { question: string; cheapestTest: string | null } | null;
}

export async function howItWasResearched(claimId: string): Promise<HowItWasResearched | null> {
  const claim = (await query(
    'SELECT id, claim, founder_id FROM market_claims WHERE id = ?', [claimId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!claim) return null;

  const obs = (await query(
    `SELECT bearing, source_type, saw, from_absence, retrieval_id
       FROM market_observations WHERE claim_id = ? ORDER BY rowid`, [claimId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const supports = obs.filter((o) => String(o.bearing) === 'supports');
  const against = obs.filter((o) => String(o.bearing) === 'contradicts');
  const kinds = new Set(obs.map((o) => String(o.source_type)));
  const restsOnAbsence = supports.some((o) => Number(o.from_absence) === 1);

  const retrievalIds = [...new Set(obs.map((o) => o.retrieval_id).filter((r) => r != null)
    .map((r) => String(r)))];
  const coverage: HowItWasResearched['coverage'] = [];
  for (const id of retrievalIds) {
    const r = (await query(
      `SELECT source_type, terms, returned_count, examined_count, relevant_count,
              can_see, cannot_see, not_also_tried, would_most_help, retrieved_at
         FROM market_retrievals WHERE id = ?`, [id]))
      .rows[0] as Record<string, unknown> | undefined;
    if (!r) continue;
    coverage.push({
      sourceType: String(r.source_type), terms: String(r.terms),
      had: Number(r.returned_count), examined: Number(r.examined_count),
      onSubject: Number(r.relevant_count),
      canSee: String(r.can_see), cannotSee: String(r.cannot_see),
      notAlsoTried: r.not_also_tried == null ? null : String(r.not_also_tried),
      wouldMostHelp: String(r.would_most_help),
      lookedAt: String(r.retrieved_at).slice(0, 10),
      retrievalId: id,
    });
  }

  const unknown = (await query(
    `SELECT question, cheapest_test FROM market_unknowns
      WHERE (claim_id = ? OR founder_id = ?) AND answered_at IS NULL
      ORDER BY blocking DESC, rowid LIMIT 1`, [claimId, String(claim.founder_id)]))
    .rows[0] as Record<string, unknown> | undefined;

  const judgment = obs.length === 0
    ? 'I have not looked into this yet.'
    : `I investigated this with ${String(obs.length)} real `
      + `${obs.length === 1 ? 'observation' : 'observations'} across `
      + `${String(kinds.size)} ${kinds.size === 1 ? 'kind' : 'kinds'} of source. `
      + `${String(supports.length)} support it and ${String(against.length)} `
      + `${against.length === 1 ? 'weakens' : 'weaken'} it.`
      + (restsOnAbsence
        ? ' Some of that support is nothing having turned up, which is weaker than '
          + 'something having been seen.' : '')
      + (unknown ? ` The largest unknown is ${String(unknown.question)}.` : '');

  return {
    observations: obs.length, sourceKinds: kinds.size,
    supports: supports.length, contradicts: against.length, restsOnAbsence,
    judgment, coverage,
    whatContradicts: against.map((o) => String(o.saw)),
    largestUnknown: unknown === undefined ? null : {
      question: String(unknown.question),
      cheapestTest: unknown.cheapest_test == null ? null : String(unknown.cheapest_test),
    },
  };
}

/**
 * SHOW ME WHAT IT ACTUALLY LOOKED AT.
 *
 * The deepest layer, and the one that makes the relevance judgement arguable:
 * everything a source returned, whether it was believed, when it was written,
 * and the words that decided. A reader who disagrees with a call can see
 * exactly which call it was.
 */
export interface WhatItLookedAt {
  label: string;
  url: string | null;
  /** When the thing itself was written or published — not when we looked. */
  writtenAt: string | null;
  believed: boolean;
  /** The words it shares with the search, which is what decided. */
  sharedTerms: string[];
  said: string | null;
}

export async function whatItLookedAt(retrievalId: string): Promise<WhatItLookedAt[]> {
  return ((await query(
    `SELECT label, url, dated_at, said, relevant, shared_terms
       FROM retrieval_items WHERE retrieval_id = ? ORDER BY relevant DESC, rowid`,
    [retrievalId])).rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    label: String(r.label),
    url: r.url == null ? null : String(r.url),
    writtenAt: r.dated_at == null ? null : String(r.dated_at).slice(0, 10),
    believed: Number(r.relevant) === 1,
    sharedTerms: r.shared_terms == null ? [] : String(r.shared_terms).split(', '),
    said: r.said == null ? null : String(r.said),
  }));
}

/**
 * NARROWING A THESIS THAT CONTRADICTION HAS OUTGROWN.
 *
 * Neither averaging the disagreement nor abandoning the idea: the move a real
 * founder makes when two good sources disagree is to believe something smaller
 * that both fit. "Cron scheduling is solved" meets people still describing
 * where it breaks and becomes "solved except across daylight saving" - which is
 * a different business, and a better one to have found now.
 *
 * THE OLD CLAIM STAYS AND IS NOT MARKED FAILED. It was not wrong, it was too
 * broad, and the record of having believed it is how the institution learns
 * what kind of claim it tends to make too broadly. The database refuses to
 * narrow a claim nothing has argued with, which would be changing the subject
 * rather than revising a thesis.
 */
export async function reviseClaim(input: {
  founderId: string; claimId: string; into: string; because: string;
  opportunityId?: string | null;
}): Promise<{ narrowerClaimId: string } | { refused: string }> {
  const standing = await standingOf(input.claimId);
  if (standing === null) return { refused: 'no such claim' };
  if (standing.contradicts === 0) {
    return {
      refused: 'nothing has contradicted this, so narrowing it would be changing '
        + 'the subject rather than revising a thesis',
    };
  }
  const narrower = await formClaim({
    founderId: input.founderId, claim: input.into,
    opportunityId: input.opportunityId ?? null, evidenceMode: 'real',
  });
  try {
    await query(
      `UPDATE market_claims
          SET revised_into = ?, revised_because = ?, revised_at = datetime('now')
        WHERE id = ?`, [narrower, input.because.trim(), input.claimId]);
  } catch (err) {
    return { refused: String((err as Error).message) };
  }
  return { narrowerClaimId: narrower };
}

/** What a claim became, and why — so nobody reads the narrower one as the original. */
export async function whatItBecame(claimId: string): Promise<{
  claim: string; because: string; when: string;
} | null> {
  const row = (await query(
    `SELECT n.claim, c.revised_because, c.revised_at
       FROM market_claims c JOIN market_claims n ON n.id = c.revised_into
      WHERE c.id = ?`, [claimId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    claim: String(row.claim), because: String(row.revised_because),
    when: String(row.revised_at).slice(0, 10),
  };
}

export interface OpenUnknown {
  id: string; question: string; blocking: boolean; cheapestTest: string | null;
}

/**
 * WHAT IS STILL NOT KNOWN, AS A THING RATHER THAN A CAVEAT.
 *
 * An unknown in prose gets dropped in the retelling. This one has to be
 * answered or explicitly accepted, and a blocking one stops a candidate
 * advancing however good the rest reads.
 */
export async function openUnknowns(opportunityId: string): Promise<OpenUnknown[]> {
  return ((await query(
    `SELECT id, question, blocking, cheapest_test FROM market_unknowns
      WHERE opportunity_id = ? AND answered_at IS NULL
      ORDER BY blocking DESC, rowid`, [opportunityId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), question: String(r.question),
    blocking: Number(r.blocking) === 1,
    cheapestTest: r.cheapest_test == null ? null : String(r.cheapest_test),
  }));
}

export async function raiseUnknown(input: {
  founderId: string; question: string; blocking: boolean;
  opportunityId?: string | null; claimId?: string | null; cheapestTest?: string | null;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO market_unknowns
       (id, founder_id, opportunity_id, claim_id, question, blocking, cheapest_test)
     VALUES (?,?,?,?,?,?,?)`,
    [id, input.founderId, input.opportunityId ?? null, input.claimId ?? null,
      input.question.trim(), input.blocking ? 1 : 0, input.cheapestTest ?? null]);
  return id;
}

/**
 * THE CHEAPEST THING THAT WOULD SETTLE THIS.
 *
 * The point of naming an unknown is to make it resolvable, not to decorate a
 * report with humility. When every blocking unknown has a named test, the
 * candidate has a route to a decision; when one does not, that is the honest
 * blocker and it is said rather than left implicit.
 */
export async function cheapestWayForward(opportunityId: string): Promise<{
  blocked: boolean; tests: string[]; without: string[];
}> {
  const unknowns = await openUnknowns(opportunityId);
  const blocking = unknowns.filter((u) => u.blocking);
  return {
    blocked: blocking.length > 0,
    tests: blocking.filter((u) => u.cheapestTest !== null)
      .map((u) => `${u.question} - ${String(u.cheapestTest)}`),
    without: blocking.filter((u) => u.cheapestTest === null).map((u) => u.question),
  };
}
