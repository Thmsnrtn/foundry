// =============================================================================
// FOUNDRY — WHETHER THIS IS WORTH THINKING ABOUT AT ALL
//
// THE CHEAPEST MODEL CALL IS THE ONE NOT MADE, and almost nothing in this
// repository asks whether it should be made. A loop is scheduled, the loop
// runs, the model is called, and the bill arrives whether or not anything had
// changed since the last time.
//
// Production, 1-14 September 2026: 1,099 settled calls, $14.88. More than half
// of it is one nightly loop asking nine agents across three companies to
// review their sessions and propose improvements. In eleven nights it changed
// nothing — every row in agent_evolution_versions is an initial provision from
// the day the agents were created, and evolved_prompts is empty. Most of those
// nights it re-read exactly the same five sessions, because no new session had
// completed.
//
// THREE REASONS TO SLEEP, in the order they are cheapest to check:
//
//   1. NOTHING TO CONSIDER — there is no material at all.
//   2. NOTHING HAS CHANGED — the material is identical to last time, so the
//      answer would be too, and paying for it again buys a copy.
//   3. IT HAS NEVER ONCE MATTERED — this question has been asked enough times,
//      over changing material, and has not once changed anything. That is not
//      a reason never to ask again; it is a reason to stop asking NIGHTLY.
//
// The third is crystallisation: a question asked two hundred times with the
// same answer has become a fact, and a fact is cheaper than a question. It is
// deliberately reversible — a settled question wakes after a week, and the
// backoff is a longer interval rather than a delete.
//
// "NOTHING WORTH DOING" IS A RESULT. A caller that sleeps has not failed; it
// has answered. That is recorded with the same care as an answer that cost
// money, because an institution that only records what it spent cannot tell
// the difference between being quiet and being broken.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

/** What is being thought about, and over what. */
export interface Occasion {
  /** A stable name for the question. Not a prompt, not a model. */
  cognition: string;
  /** The subject that makes two occasions comparable. */
  about: string;
}

/**
 * HOW MANY FRUITLESS OCCASIONS BEFORE A QUESTION IS TREATED AS SETTLED.
 *
 * Five, because the loop this was built for runs nightly: five nights is long
 * enough that a run of nothing is not chance, and short enough that a week of
 * paying for nothing is the most it can cost before it notices.
 */
export const FRUITLESS_BEFORE_SETTLED = 5;

/**
 * HOW LONG A SETTLED QUESTION SLEEPS BEFORE IT IS ASKED AGAIN.
 *
 * Seven days. Not never: the material goes on changing, and a question that
 * has never mattered may one day matter. This is the difference between
 * crystallising an answer and forgetting the question.
 */
export const SETTLED_SLEEP_DAYS = 7;

/** The digest of no material at all. */
export const NOTHING = 'nothing';

/**
 * A DIGEST OF THE MATERIAL.
 *
 * Callers pass whatever they would actually read. Ordering matters and is the
 * caller's to fix: two lists in different orders are, to this function, two
 * different materials, which errs towards thinking rather than towards a false
 * sleep.
 *
 * An empty material produces NOTHING, so "there was nothing to consider" is a
 * state that can be recognised later rather than an absence of a row.
 */
export function digestOf(parts: readonly (string | number | null | undefined)[]): string {
  const real = parts.filter((p) => p != null && String(p) !== '');
  if (real.length === 0) return NOTHING;
  const h = createHash('sha256');
  for (const p of real) { h.update(String(p)); h.update(' '); }
  return h.digest('hex').slice(0, 32);
}

export type Verdict =
  | { think: true; because: string }
  | { think: false; because: string; lastThoughtAt: string | null };


/**
 * SHOULD THIS BE THOUGHT ABOUT NOW?
 *
 * Read-only and cheap: one indexed query against one table. Safe to call from
 * inside a loop that runs every night against every subject it has.
 *
 * WHY IT NEVER REFUSES ON COST. Ceilings are enforced in the spend ledger,
 * where they belong, and mixing the two would give this function the power to
 * silence thinking the owner has paid for and wants. Its only argument is that
 * the thinking would tell nobody anything.
 */
export async function shouldThink(
  o: Occasion, overDigest: string, now: Date = new Date(),
): Promise<Verdict> {
  if (overDigest === NOTHING) {
    return { think: false, because: 'there is nothing here to think about', lastThoughtAt: null };
  }

  // THE MOST RECENT OCCASION OF ANY KIND, slept ones included — a sleep
  // records the digest it saw, so a run of unchanged nights stays one
  // comparison rather than a growing scan.
  const last = (await query(
    `SELECT over_digest FROM cognition_occasions
      WHERE cognition = ? AND about = ? ORDER BY at DESC LIMIT 1`,
    [o.cognition, o.about])).rows[0] as Record<string, unknown> | undefined;

  if (!last) {
    return { think: true, because: 'I have not considered this before' };
  }

  // 2. NOTHING HAS CHANGED.
  // WHY THE WHOLE HISTORY AND NOT A WINDOW OF THE LAST FIFTEEN ROWS, which is
  // how this was first written. Once the backoff engages the rows are mostly
  // SLEEPS — six a week against one thought — so within a fortnight the
  // thoughts scroll out of any fixed window, the fruitless count collapses
  // below the threshold, and the question quietly resumes asking itself every
  // night. A settled question that un-settles itself on a technicality is
  // worse than one that never settled, because nobody would ever notice.
  // Counted instead by two indexed aggregates over the whole history.
  const tally = (await query(
    `SELECT COUNT(*) AS thoughts,
            SUM(CASE WHEN changed_something = 0 THEN 1 ELSE 0 END) AS fruitless,
            SUM(COALESCE(changed_something, 0)) AS mattered,
            MAX(at) AS last_thought_at
       FROM cognition_occasions
      WHERE cognition = ? AND about = ? AND thought = 1`,
    [o.cognition, o.about])).rows[0] as Record<string, unknown>;
  const lastThoughtAt = tally.last_thought_at == null ? null : String(tally.last_thought_at);

  if (String(last.over_digest) === overDigest) {
    return {
      think: false,
      because: 'nothing has changed since I last considered this',
      lastThoughtAt,
    };
  }

  // 3. IT HAS NEVER ONCE MATTERED. Only occasions that actually thought can
  // testify: a sleep is not evidence that thinking would have been fruitless,
  // and counting it as such is how a loop talks itself into never waking.
  const fruitless = Number(tally.fruitless ?? 0);
  const everMattered = Number(tally.mattered ?? 0) > 0;
  if (!everMattered && fruitless >= FRUITLESS_BEFORE_SETTLED) {
    const since = lastThoughtAt === null ? null
      : (now.getTime() - Date.parse(`${lastThoughtAt.replace(' ', 'T')}Z`)) / 86_400_000;
    if (since !== null && Number.isFinite(since) && since < SETTLED_SLEEP_DAYS) {
      return {
        think: false,
        because: `I have considered this ${String(fruitless)} times and it has never once `
          + 'changed anything, so I am asking weekly rather than daily',
        lastThoughtAt,
      };
    }
    return {
      think: true,
      because: `${String(SETTLED_SLEEP_DAYS)} days since I last considered a question that has `
        + 'never changed anything — worth one more look',
    };
  }

  return { think: true, because: 'the material has changed since I last considered it' };
}

/**
 * WHAT HAPPENED. Called whether it thought or slept — a record of sleeping is
 * the only thing that makes the next sleep decidable.
 *
 * `changedSomething` is deliberately absent when it slept. An occasion that did
 * not happen did not fail to change anything.
 */
export async function recordOccasion(input: {
  occasion: Occasion; overDigest: string; thought: boolean; because: string;
  changedSomething?: boolean; cents?: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO cognition_occasions
       (id, cognition, about, over_digest, thought, because, changed_something, cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), input.occasion.cognition, input.occasion.about, input.overDigest,
      input.thought ? 1 : 0, input.because,
      input.thought ? (input.changedSomething === true ? 1 : 0) : null,
      input.cents ?? null]);
}

/**
 * THE WHOLE PATTERN IN ONE CALL, for a caller that just wants the behaviour.
 *
 * `run` is only invoked when it is worth thinking. It returns whether anything
 * changed, and optionally what it cost; everything else is recorded here.
 */
export async function consider<T>(
  o: Occasion,
  overDigest: string,
  run: () => Promise<{ changedSomething: boolean; cents?: number | null; value: T }>,
  now: Date = new Date(),
): Promise<{ thought: boolean; because: string; value: T | null }> {
  const verdict = await shouldThink(o, overDigest, now);
  if (!verdict.think) {
    await recordOccasion({ occasion: o, overDigest, thought: false, because: verdict.because });
    return { thought: false, because: verdict.because, value: null };
  }
  const outcome = await run();
  await recordOccasion({
    occasion: o, overDigest, thought: true, because: verdict.because,
    changedSomething: outcome.changedSomething, cents: outcome.cents ?? null,
  });
  return { thought: true, because: verdict.because, value: outcome.value };
}

// --- WHAT THINKING COSTS ----------------------------------------------------

export interface CognitionLine {
  cognition: string;
  thought: number;
  slept: number;
  changedSomething: number;
  /** Settled cents where they were recorded. Null where none were. */
  cents: number | null;
  /** The commonest reason it slept, in its own words. */
  sleptBecause: string | null;
}

export interface CognitionEconomics {
  days: number;
  /** Every model call the ledger settled in the window, by model. */
  byModel: Array<{ model: string; calls: number; cents: number }>;
  /**
   * The same money, grouped by WHAT IT WAS FOR.
   *
   * `byModel` answers the question about the provider; this answers the one
   * about the institution. A `work` of null is spend from before every call
   * site had to say, reported as unattributed rather than dropped — a reading
   * that omitted it would disagree with the ledger's own total.
   */
  byWork: Array<{ work: string | null; calls: number; cents: number }>;
  /** Everything that was asked whether it was worth thinking about. */
  considered: CognitionLine[];
  totalCents: number;
  /** What was NOT spent because something slept, where it can be told. */
  notSpentCents: number | null;
  /** One sentence. */
  sentence: string;
}

/**
 * WHAT THE INSTITUTION SPENT THINKING, AND WHAT IT GOT.
 *
 * Two records that do not join, and saying so is the point: the spend ledger
 * knows what every call cost and mostly not what it was for, while the
 * occasions table knows what was asked and only sometimes what it cost. The
 * honest reading shows both and does not pretend one explains the other.
 */
export async function cognitionEconomics(days = 30): Promise<CognitionEconomics> {
  const since = `-${String(Math.max(1, Math.floor(days)))} day`;

  // NOT READ HERE. `ai_spend_reservations` survives an erasure for accounting
  // and ceiling enforcement only, and every reader of it lives in the module
  // that keeps that promise. This was written inline first and the retention
  // gate refused it by name, which is the gate doing its job: a disposition
  // that lets a table outlive an erasure is a promise about what will be done
  // with it afterwards, and a reader somewhere else is the later use the
  // promise excludes.
  const { settledByModel, settledByWork } = await import('./spend-ledger.js');
  const [byModel, byWork] = await Promise.all([settledByModel(days), settledByWork(days)]);

  const considered = (await query(
    `SELECT cognition,
            SUM(thought) AS thought,
            SUM(CASE WHEN thought = 0 THEN 1 ELSE 0 END) AS slept,
            SUM(COALESCE(changed_something, 0)) AS changed,
            SUM(COALESCE(cents, 0)) AS cents,
            COUNT(cents) AS costed
       FROM cognition_occasions
      WHERE at >= datetime('now', ?)
      GROUP BY cognition ORDER BY slept DESC`, [since]))
    .rows as unknown as Array<Record<string, unknown>>;

  const lines: CognitionLine[] = [];
  for (const row of considered) {
    const reason = (await query(
      `SELECT because, COUNT(*) AS n FROM cognition_occasions
        WHERE cognition = ? AND thought = 0 AND at >= datetime('now', ?)
        GROUP BY because ORDER BY n DESC LIMIT 1`, [String(row.cognition), since]))
      .rows[0] as Record<string, unknown> | undefined;
    lines.push({
      cognition: String(row.cognition),
      thought: Number(row.thought),
      slept: Number(row.slept),
      changedSomething: Number(row.changed),
      cents: Number(row.costed) > 0 ? Math.round(Number(row.cents) * 100) / 100 : null,
      sleptBecause: reason ? String(reason.because) : null,
    });
  }

  const totalCents = Math.round(byModel.reduce((a, m) => a + m.cents, 0) * 100) / 100;

  // WHAT SLEEPING SAVED, only where an occasion of the same question actually
  // recorded a cost. Where none did, this is null rather than zero: an unknown
  // saving reported as nothing is the same lie in the other direction.
  const costed = lines.filter((l) => l.cents !== null && l.thought > 0);
  const notSpent = costed.length === 0 ? null
    : Math.round(costed.reduce((a, l) => a + ((l.cents ?? 0) / l.thought) * l.slept, 0) * 100) / 100;

  const slept = lines.reduce((a, l) => a + l.slept, 0);
  const sentence = lines.length === 0
    ? `$${(totalCents / 100).toFixed(2)} on thinking in ${String(days)} days. Nothing yet asks `
      + 'itself whether it is worth thinking about.'
    : `$${(totalCents / 100).toFixed(2)} on thinking in ${String(days)} days`
      + (slept > 0
        ? `, and ${String(slept)} ${slept === 1 ? 'time' : 'times'} I decided there was nothing `
          + 'worth thinking about and did not spend it.'
        : ', and nothing slept.');

  return { days, byModel, byWork, considered: lines, totalCents, notSpentCents: notSpent, sentence };
}
