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
    'SELECT id, claim, settled_as FROM market_claims WHERE id = ?', [claimId]))
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
  // A vendor saying its own price is authoritative about price and worthless
  // about whether anyone pays it. Counting stances separately is what stops six
  // pricing pages reading as six independent confirmations.
  const stances = new Set(supporting.map((r) => String(r.stance)));

  const howItStands = rows.length === 0
    ? 'Nothing has been seen about this yet.'
    : against.length > 0
      ? `${String(supporting.length)} ${supporting.length === 1 ? 'thing supports' : 'things support'} `
        + `this and ${String(against.length)} ${against.length === 1 ? 'contradicts' : 'contradict'} `
        + 'it. I am not going to average that into a verdict - it means the question '
        + 'is open, and what would settle it is worth more than another agreeing source.'
      : direct === 0
        ? `Everything supporting this was worked out rather than seen. Nothing has `
          + 'directly said it.'
        : stances.size === 1 && stances.has('self_reported')
          ? `${String(supporting.length)} sources support this and all of them are `
            + 'companies talking about themselves. That is good evidence about what '
            + 'they charge and no evidence at all about what anyone pays.'
          : stale === supporting.length && supporting.length > 0
            ? `${String(supporting.length)} sources support this and all of them are `
              + 'more than six months old. That is evidence about last year.'
            : `${String(direct)} of ${String(supporting.length)} supporting observations `
              + `say it directly, across ${String(kinds.length)} `
              + `${kinds.length === 1 ? 'kind' : 'kinds'} of source. Nothing contradicts it yet.`;

  return {
    claimId: String(claim.id), claim: String(claim.claim),
    supports: supporting.length, contradicts: against.length,
    direct, stale, kindsOfSource: kinds, howItStands,
    settled: claim.settled_as == null ? null : String(claim.settled_as) as 'held' | 'failed',
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
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO market_observations
       (id, founder_id, claim_id, source_type, source, saw, bearing, directness,
        observed_at, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.claimId, input.sourceType, input.source.trim(),
      input.saw.trim(), input.bearing, input.directness,
      input.observedAt.toISOString(), input.evidenceMode]);
  return id;
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
