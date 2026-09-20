/**
 * PRECEDENT: WHAT A SETTLED TEST DOES TO THE NEXT ONE.
 *
 * Experiment 001 settled, and nothing stood between the forge and asking its
 * question again in new words: the proposer refused only a test still in
 * flight for the same unknown, the deliberation saw the last ten lessons as
 * prose, and the sealing rule never looked back. A month of ownership in the
 * laboratory found the institution able to learn and unable to act on it.
 *
 * This is the one reader that answers, for a candidate and a proposed design,
 * whether a settled test on the same candidate already asked this question by
 * this mechanism. Three answers, each with the scope that makes it honest:
 *
 *   asked_before  the same question, the same mechanism — the same exchange
 *                 and the same way of reaching people — settled already. The
 *                 next design must say what it changes, or be a re-run on the
 *                 record (`rerun_of`). Refused, with the precedent named.
 *   narrowed      the same question by a different mechanism, or the same
 *                 mechanism for a different question: allowed, and the design
 *                 is told what the earlier result established and did not.
 *   clear         nothing settled on this candidate bears on it.
 *
 * Appropriately, not universally: a settled test binds only its own candidate.
 * A different opportunity is never a precedent here, and nothing the reader
 * says alters a sealed record. The comparisons are deterministic and written
 * out in `because`, so the owner can disagree with the reading, not guess it.
 */
import { query } from '../../db/client.js';
import { GRADE_SQL, outcomeFromRow, type Outcome, type OutcomeRow } from '../founder/what-happened.js';

export interface PrecedentRef {
  experimentId: string;
  unknownId: string;
  whatWeDid: string;
  question: string;
  outcome: Outcome;
  decides: string | null;
  exchange: string | null;
  distribution: string | null;
  /** The one-line reading a card shows: "Tested before: … settled surprised on …; establishes …; does not establish …". */
  line: string;
}

export interface Precedent {
  stands: 'clear' | 'asked_before' | 'narrowed';
  /** Settled tests that asked this question by this mechanism. */
  sameQuestion: PrecedentRef[];
  /** Settled tests on the candidate that bear on it without being the same. */
  nearby: PrecedentRef[];
  because: string;
}

export interface ProposedDesign {
  whatWeDo?: string | null;
  question?: string | null;
  unknownId?: string | null;
  decides?: string | null;
  exchange?: string | null;
  distribution?: string | null;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'at', 'by', 'with', 'is', 'are', 'be', 'that', 'this', 'it', 'as', 'will', 'would', 'whether', 'who', 'what', 'one', 'each', 'we', 'i', 'up', 'front', 'under', 'from', 'their', 'its', 'not', 'no', 'any', 'do', 'does', 'if', 'then']);

/** The words of a sentence that carry it, for a deterministic overlap. */
export function words(s: string | null | undefined): Set<string> {
  return new Set((s ?? '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').split(/\s+/)
    .map((w) => w.replace(/(ies|es|s)$/, (m) => m === 'ies' ? 'y' : ''))
    .filter((w) => w.length > 2 && !STOP.has(w)));
}

/**
 * How much of the shorter sentence's carrying words the longer one holds,
 * 0..1. The shorter side is the measure on purpose: a sealed design says its
 * distribution in a paragraph and a new proposal says the same act in a line,
 * and the question is whether the line is inside the paragraph, not whether
 * the two are the same length. Empty against anything is 0.
 */
export function overlap(a: string | null | undefined, b: string | null | undefined): number {
  const A = words(a); const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / Math.min(A.size, B.size);
}

/** The thresholds, named once so `because` can say them. */
export const SAME_QUESTION_AT = 0.6;
export const SAME_MECHANISM_AT = 0.6;

const settledOn = async (founderId: string, opportunityId: string, except: string | null): Promise<PrecedentRef[]> => {
  const rows = (await query(
    `SELECT e.id, e.what_we_do, e.unknown_id, u.question, e.decision, e.validity, e.verdict, e.what_happened, e.ran_at,
            e.retired_at, e.retired_because, e.superseded_by, e.invalidated_at, e.invalid_because, e.decided_at,
            d.decides, d.exchange, d.distribution, d.cannot_prove, ${GRADE_SQL} AS grade
       FROM venture_experiments e
       JOIN market_unknowns u ON u.id = e.unknown_id
       LEFT JOIN probe_designs d ON d.experiment_id = e.id
      WHERE e.founder_id = ? AND e.opportunity_id = ? AND e.evidence_mode = 'real'
        AND e.ran_at IS NOT NULL AND e.verdict IS NOT NULL AND e.validity = 'valid'
        AND (? IS NULL OR e.id <> ?)
      ORDER BY e.ran_at DESC`, [founderId, opportunityId, except, except])).rows as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const outcome = outcomeFromRow(r as OutcomeRow);
    const when = outcome.when ? ` on ${outcome.when.slice(0, 10)}` : '';
    return {
      experimentId: String(r.id), unknownId: String(r.unknown_id), whatWeDid: String(r.what_we_do), question: String(r.question), outcome,
      decides: r.decides == null ? null : String(r.decides), exchange: r.exchange == null ? null : String(r.exchange),
      distribution: r.distribution == null ? null : String(r.distribution),
      line: `Tested before: ${String(r.what_we_do)} — settled ${outcome.word}${when}. It establishes ${outcome.establishes ?? 'nothing yet'} It does not establish ${outcome.doesNotEstablish ?? ''}`.trim(),
    };
  });
};

/**
 * THE READING. `except` is the experiment being designed, so it is never its
 * own precedent; `rerunOf` names the settled test this one deliberately
 * repeats, which is the one honest way to ask the same question again.
 */
export async function precedentFor(input: {
  founderId: string; opportunityId: string; except?: string | null; rerunOf?: string | null; design: ProposedDesign;
}): Promise<Precedent> {
  const settled = await settledOn(input.founderId, input.opportunityId, input.except ?? null);
  if (settled.length === 0) return { stands: 'clear', sameQuestion: [], nearby: [], because: 'no test on this candidate has settled' };
  const d = input.design;
  const same: PrecedentRef[] = []; const nearby: PrecedentRef[] = []; const notes: string[] = [];
  for (const s of settled) {
    if (input.rerunOf && input.rerunOf === s.experimentId) {
      nearby.push(s); notes.push(`a re-run of ${s.experimentId}, on the record`); continue;
    }
    const questionOverlap = Math.max(overlap(d.question, s.question), overlap(d.decides, s.decides));
    const sameQuestion = (d.unknownId != null && d.unknownId === s.unknownId) || questionOverlap >= SAME_QUESTION_AT;
    // The mechanism is the exchange and the way of reaching people when the
    // design has them; before it does, the proposed act itself.
    const mechanismOverlap = d.exchange && s.exchange
      ? (d.exchange === s.exchange ? Math.max(overlap(d.distribution, s.distribution), overlap(d.whatWeDo, s.whatWeDid)) : 0)
      : overlap(d.whatWeDo, s.whatWeDid);
    const sameMechanism = mechanismOverlap >= SAME_MECHANISM_AT;
    if (sameQuestion && sameMechanism) {
      same.push(s);
      notes.push(`${s.experimentId} asked this (question overlap ${questionOverlap.toFixed(2)}) by this mechanism (overlap ${mechanismOverlap.toFixed(2)}) and settled ${s.outcome.word}`);
    } else if (sameQuestion || sameMechanism) {
      nearby.push(s);
      notes.push(sameQuestion
        ? `${s.experimentId} asked this question by a different mechanism (overlap ${mechanismOverlap.toFixed(2)}) and settled ${s.outcome.word}`
        : `${s.experimentId} used this mechanism for a different question (overlap ${questionOverlap.toFixed(2)}) and settled ${s.outcome.word}`);
    }
  }
  if (same.length > 0) {
    return { stands: 'asked_before', sameQuestion: same, nearby,
      because: `${notes.join('; ')}. Thresholds: ${String(SAME_QUESTION_AT)} of the carrying words of the question, ${String(SAME_MECHANISM_AT)} of the mechanism.` };
  }
  if (nearby.length > 0) return { stands: 'narrowed', sameQuestion: [], nearby, because: notes.join('; ') };
  return { stands: 'clear', sameQuestion: [], nearby: [], because: `${String(settled.length)} settled on this candidate, none asking this question or using this mechanism` };
}

/** The sentence a refusal carries, naming the precedent and the way through. */
export function askedBeforeSentence(p: Precedent): string {
  const s = p.sameQuestion[0]!;
  const when = s.outcome.when ? ` on ${s.outcome.when.slice(0, 10)}` : '';
  return `this asks the same question ${s.experimentId} settled${when} (${s.outcome.word}) by the same mechanism; `
    + 'propose what it would change, or mark it a re-run';
}

/** The precedent of an experiment already on the rows, from its own fields. */
export async function precedentOfExperiment(experimentId: string): Promise<Precedent | null> {
  const e = (await query(
    `SELECT e.founder_id, e.opportunity_id, e.what_we_do, e.unknown_id, e.rerun_of, u.question, d.decides, d.exchange, d.distribution
       FROM venture_experiments e JOIN market_unknowns u ON u.id = e.unknown_id
       LEFT JOIN probe_designs d ON d.experiment_id = e.id WHERE e.id = ?`, [experimentId])).rows[0] as Record<string, unknown> | undefined;
  if (!e) return null;
  return precedentFor({
    founderId: String(e.founder_id), opportunityId: String(e.opportunity_id), except: experimentId,
    rerunOf: e.rerun_of == null ? null : String(e.rerun_of),
    design: { whatWeDo: String(e.what_we_do), question: String(e.question), unknownId: String(e.unknown_id),
      decides: e.decides == null ? null : String(e.decides), exchange: e.exchange == null ? null : String(e.exchange),
      distribution: e.distribution == null ? null : String(e.distribution) },
  });
}

/** What a candidate's card says: the settled tests on it, one line each. */
export async function testedBefore(founderId: string, opportunityId: string): Promise<PrecedentRef[]> {
  return settledOn(founderId, opportunityId, null);
}
