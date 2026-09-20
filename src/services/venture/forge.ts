// =============================================================================
// FOUNDRY — the forge: what is worth testing next, read rather than imagined
//
// An experiment is the most expensive thing this institution does. It reaches
// strangers, it spends money, and it produces a claim the rest of the estate
// will lean on. So the question "what should we test next" must not be answered
// by anything that can invent — and here it is not answered at all. It is READ,
// from three kinds of row that already exist:
//
//   THE UNKNOWNS. `market_unknowns` are questions somebody wrote down as
//   unanswered, each marked blocking or merely untidy, each with the cheapest
//   thing that would answer it. An unknown with no cheapest test is a question
//   nobody has worked out how to settle, and it says so rather than being
//   dropped from the list.
//
//   `kind = 'question'` ONLY. That table also holds readings of a SOURCE —
//   what a text might have meant, how it might have been misread — written by
//   discovery alongside the real question. They belong in the record and they
//   are not things you can put to the world: no amount of contacting strangers
//   establishes what a forum post from last year meant. Migration 314 gave
//   them their own kind; before it, a phrase match had marked several of them
//   BLOCKING, which would have put "it could instead mean: this could just be
//   a passing technical question" at the top of what to test next.
//
//   WHAT THE LAST ONE ESTABLISHED. An experiment that has settled produces a
//   verdict and, more usefully, a written limit: what it could not establish.
//   The next design has to answer to that limit or it is asking the same
//   question again in different words.
//
//   WHAT STANDS IN THE WAY. `designStandsInTheWay` already says what is
//   missing before a particular test could run. The same reading, applied to a
//   candidate rather than to a live test, is the difference between "worth
//   testing" and "testable".
//
// WHAT THIS DOES NOT DO, DELIBERATELY:
//
//   It does not rank. An ordering over questions about the world would be a
//   claim about the world, and the institution's only honest ordering is the
//   one already written down: blocking before untidy, cheapest first.
//
//   It does not compose the design. `recordDesign` takes judgement sentences —
//   what this decides, what it can and cannot prove, what would stop it — and
//   those are the owner's or they are nobody's. The forge lays out what is
//   known so he is not writing them from a blank page.
//
//   It never touches a running test. Experiment 001's cohort, price, message,
//   strata, rollout and stop envelope are untouchable by anything here.
// =============================================================================

import { GRADE_SQL, outcomeFromRow, type Outcome, type OutcomeRow } from '../founder/what-happened.js';
import { query } from '../../db/client.js';

export interface OpenQuestion {
  unknownId: string;
  question: string;
  blocking: boolean;
  /** The cheapest thing that would answer it, where somebody worked one out. */
  cheapestTest: string | null;
  raisedAt: string;
  opportunityId: string | null;
  opportunityHeadline: string | null;
  /** A test already running or decided against this question, if there is one. */
  alreadyTesting: { experimentId: string; state: string } | null;
}

export interface Lesson {
  experimentId: string;
  /** What the test was, in the words sealed with it. */
  whatWeDid: string;
  /** What the world did, where it has answered. */
  verdict: string | null;
  /** The limit the design wrote down before it ran: what it could not prove. */
  couldNotEstablish: string | null;
  /** What the design said it would decide. */
  decided: string | null;
  settledAt: string | null;
  /** What happened, in the one vocabulary. */
  outcome: Outcome;
}

export interface Forge {
  /** Questions nobody has answered, blocking first, then oldest. */
  open: OpenQuestion[];
  /** What earlier tests established, and what they explicitly did not. */
  lessons: Lesson[];
  /** One sentence for the top of the page. */
  sentence: string;
}

/**
 * WHAT IS UNANSWERED, AND WHAT HAS ALREADY BEEN LEARNED.
 *
 * Real evidence mode only. A reference experiment is a rehearsal, and a lesson
 * drawn from one would be a lesson about a company that does not exist.
 */
export async function forgeFor(founderId: string): Promise<Forge> {
  const unknowns = await query(
    `SELECT u.id, u.question, u.blocking, u.cheapest_test, u.raised_at,
            u.opportunity_id, o.headline,
            (SELECT e.id FROM venture_experiments e
              WHERE e.unknown_id = u.id AND e.retired_at IS NULL
              ORDER BY e.proposed_at DESC LIMIT 1) AS experiment_id,
            (SELECT CASE WHEN e.decision IS NULL THEN 'proposed'
                         WHEN e.decision = 'declined' THEN 'declined'
                         WHEN e.verdict IS NOT NULL THEN 'settled'
                         ELSE 'running' END
               FROM venture_experiments e
              WHERE e.unknown_id = u.id AND e.retired_at IS NULL
              ORDER BY e.proposed_at DESC LIMIT 1) AS experiment_state
       FROM market_unknowns u
       LEFT JOIN venture_opportunities o ON o.id = u.opportunity_id
      WHERE u.founder_id = ? AND u.answered_at IS NULL AND u.kind = 'question'
        AND (o.id IS NULL OR o.evidence_mode = 'real')
      ORDER BY u.blocking DESC, u.raised_at`, [founderId]);

  const open: OpenQuestion[] = unknowns.rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      unknownId: String(r.id),
      question: String(r.question),
      blocking: Number(r.blocking) === 1,
      cheapestTest: r.cheapest_test == null ? null : String(r.cheapest_test),
      raisedAt: String(r.raised_at),
      opportunityId: r.opportunity_id == null ? null : String(r.opportunity_id),
      opportunityHeadline: r.headline == null ? null : String(r.headline),
      alreadyTesting: r.experiment_id == null
        ? null
        : { experimentId: String(r.experiment_id), state: String(r.experiment_state) },
    };
  });

  const lessons = await lessonsFor(founderId);
  return { open, lessons, sentence: sentenceFor(open, lessons) };
}

/**
 * WHAT EARLIER TESTS TAUGHT, INCLUDING WHAT THEY DID NOT.
 *
 * `cannot_prove` is the useful half and it was written BEFORE the test ran, at
 * design time, which is what makes it evidence rather than a rationalisation.
 * A design that forgets it is asking the same question again in different
 * words.
 */
export async function lessonsFor(founderId: string): Promise<Lesson[]> {
  const r = await query(
    `SELECT e.id, e.what_we_do, e.verdict, e.ran_at, d.cannot_prove, d.decides,
            e.decision, e.validity, e.what_happened, e.retired_at, e.retired_because, e.superseded_by,
            e.invalidated_at, e.invalid_because, e.decided_at, ${GRADE_SQL} AS grade
       FROM venture_experiments e
       LEFT JOIN probe_designs d ON d.experiment_id = e.id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real'
        AND e.decision = 'approved'
      ORDER BY COALESCE(e.ran_at, e.decided_at, e.proposed_at) DESC
      LIMIT 10`, [founderId]);
  return r.rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      experimentId: String(row.id),
      whatWeDid: String(row.what_we_do),
      verdict: row.verdict == null ? null : String(row.verdict),
      couldNotEstablish: row.cannot_prove == null ? null : String(row.cannot_prove),
      decided: row.decides == null ? null : String(row.decides),
      settledAt: row.ran_at == null ? null : String(row.ran_at),
      outcome: outcomeFromRow(row as OutcomeRow),
    };
  });
}

function sentenceFor(open: OpenQuestion[], lessons: Lesson[]): string {
  const untested = open.filter((q) => q.alreadyTesting === null);
  const blocking = untested.filter((q) => q.blocking);
  if (open.length === 0) {
    return lessons.length === 0
      ? 'Nothing is written down as unanswered, so there is nothing here to design against. Questions arrive from what I notice and from what you ask.'
      : 'Every question I have written down is either answered or being tested.';
  }
  if (untested.length === 0) {
    return `${String(open.length)} ${open.length === 1 ? 'question is' : 'questions are'} unanswered, and every one of them already has a test against it.`;
  }
  const head = blocking.length > 0
    ? `${String(blocking.length)} unanswered ${blocking.length === 1 ? 'question is' : 'questions are'} blocking a decision`
    : `${String(untested.length)} ${untested.length === 1 ? 'question is' : 'questions are'} unanswered and untidy rather than blocking`;
  const noTest = untested.filter((q) => !q.cheapestTest).length;
  const tail = noTest > 0
    ? ` ${String(noTest)} of them ${noTest === 1 ? 'has' : 'have'} no cheapest test written down, which is the first thing to work out.`
    : '';
  return `${head}.${tail}`;
}
