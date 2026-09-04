// =============================================================================
// FOUNDRY — the institution becomes more intelligent because it operated reality
//
// A prediction that is never graded teaches nothing. This institution seals
// predictions with unusual discipline — an experiment states what it expects
// and what would disprove it, sealed at approval; an interpretation states what
// would show it misread a sentence, and the database refuses to let that be
// edited afterwards — and until now nothing ever compared any of them to what
// happened.
//
// WHAT THIS IS FOR, in order of how much it matters:
//
//   AUTHORITY IS EARNED AGAINST A RECORD. The institution is meant to acquire
//   broader agency by demonstrating judgment, not by having governance removed.
//   There was no record to earn it against.
//
//   EFFORT SHOULD FOLLOW SURPRISE. An asset behaving as predicted should cost
//   almost nothing to watch; one diverging should pull attention and compute
//   toward it. That cannot be computed until predictions resolve.
//
//   A RECOMMENDER WITH NO TRACK RECORD SHOULD BE RUBBER-STAMPED. If every card
//   he sees is the first card the institution has ever produced, agreeing with
//   it costs him nothing and means nothing.
//
// WHAT THIS IS NOT. It does not grade itself. Every resolution names what
// settled it and carries a reference that can be looked at, so a grade can be
// disagreed with. `resolved_by` has no value meaning "the model concluded it
// had been right".
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type PredictionKind = 'venture_experiment' | 'observation_interpretation'
  | 'institutional_judgment' | 'proposed_act';
export type Verdict = 'as_predicted' | 'partly' | 'surprised';
export type SettledBy = 'owner' | 'experiment_result' | 'later_observation'
  | 'business_outcome';

/**
 * BELOW THIS, A RATE IS A STORY.
 *
 * Three graded predictions produce percentages that swing thirty points on the
 * fourth, and a number that moves like that invites exactly the false
 * confidence this whole apparatus exists to prevent. Under the floor the honest
 * output is the count and nothing else.
 */
export const ENOUGH_TO_HAVE_A_RATE = 8;

export async function resolvePrediction(input: {
  founderId: string; kind: PredictionKind; predictionId: string;
  resolvedBy: SettledBy; evidenceRef: string; verdict: Verdict;
  because: string; predictedAt: string;
}): Promise<{ id: string } | { refused: string }> {
  const already = (await query(
    'SELECT id FROM prediction_resolutions WHERE kind = ? AND prediction_id = ?',
    [input.kind, input.predictionId])).rows[0] as Record<string, unknown> | undefined;
  // Refused rather than thrown: a second attempt is usually two paths noticing
  // the same answer, which is not an error and must not become one that stops
  // a job mid-sweep.
  if (already) return { refused: 'that prediction has already been settled, once' };

  const id = nanoid();
  await query(
    `INSERT INTO prediction_resolutions
       (id, founder_id, kind, prediction_id, resolved_by, evidence_ref, verdict,
        because, predicted_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.kind, input.predictionId, input.resolvedBy,
      input.evidenceRef.trim(), input.verdict, input.because.trim(),
      input.predictedAt]);
  return { id };
}

export interface HowOftenRight {
  kind: PredictionKind | 'all';
  graded: number;
  asPredicted: number;
  partly: number;
  surprised: number;
  /** Null until there are enough to mean anything. Silence, not a small number. */
  rate: number | null;
  /**
   * HOW MANY OF THOSE THE WORLD SETTLED, rather than the owner's opinion.
   *
   * A record graded entirely by him agreeing with it is a record of agreement.
   * The invariant is that internal activity does not prove market value — and a
   * hit rate assembled from his own retrospective judgment is internal activity
   * wearing a number. This is the column that keeps the two apart.
   */
  settledByTheWorld: number;
  /** How long, on average, a prediction waits for its answer. */
  daysToAnswer: number | null;
  /** One sentence, in his words, safe to put on a card. */
  sentence: string;
}

/**
 * HOW OFTEN THIS HAS BEEN RIGHT BEFORE.
 *
 * The line that belongs on a decision card, because a recommendation from
 * something with a known record is a different object from the same words with
 * no record behind them.
 */
export async function howOftenRight(
  founderId: string, kind?: PredictionKind,
): Promise<HowOftenRight> {
  const row = (await query(
    `SELECT COUNT(*) AS graded,
            SUM(CASE WHEN verdict = 'as_predicted' THEN 1 ELSE 0 END) AS right_,
            SUM(CASE WHEN verdict = 'partly' THEN 1 ELSE 0 END) AS partly,
            SUM(CASE WHEN verdict = 'surprised' THEN 1 ELSE 0 END) AS wrong,
            SUM(CASE WHEN resolved_by <> 'owner' THEN 1 ELSE 0 END) AS by_world,
            AVG(julianday(resolved_at) - julianday(predicted_at)) AS days
       FROM prediction_resolutions
      WHERE founder_id = ?${kind === undefined ? '' : ' AND kind = ?'}`,
    kind === undefined ? [founderId] : [founderId, kind]))
    .rows[0] as Record<string, unknown>;

  const graded = Number(row.graded ?? 0);
  const asPredicted = Number(row.right_ ?? 0);
  const enough = graded >= ENOUGH_TO_HAVE_A_RATE;
  return {
    kind: kind ?? 'all',
    graded,
    asPredicted,
    partly: Number(row.partly ?? 0),
    surprised: Number(row.wrong ?? 0),
    rate: enough ? asPredicted / graded : null,
    settledByTheWorld: Number(row.by_world ?? 0),
    daysToAnswer: row.days == null ? null : Math.round(Number(row.days) * 10) / 10,
    sentence: graded === 0
      ? 'I have not been graded on anything yet, so you have no reason to take my '
        + 'word for this.'
      : enough
        ? `When I have said this kind of thing before, I was right ${String(asPredicted)} `
          + `of ${String(graded)} times`
          + (Number(row.by_world ?? 0) === graded ? ', every one settled by what '
            + 'actually happened rather than by your opinion of it.'
            : `, ${String(row.by_world ?? 0)} of them settled by what actually `
              + 'happened rather than by your opinion of it.')
        : `I have been graded ${String(graded)} ${graded === 1 ? 'time' : 'times'} so `
          + 'far — not enough to tell you a rate that would mean anything.',
  };
}

export interface AwaitingAnswer {
  kind: PredictionKind;
  predictionId: string;
  /** What was predicted, verbatim from where it was sealed. */
  expected: string;
  /** And what would have meant it was wrong. */
  wouldDisprove: string | null;
  predictedAt: string;
  dueAt: string | null;
  overdue: boolean;
  /** The thing this prediction was about, so a question can name it. */
  about: string;
}

/**
 * WHAT WAS PROMISED AND NOT YET ACCOUNTED FOR.
 *
 * Only experiments today, because they are the only kind with an approval, a
 * due date and a person who ran it. Interpretations resolve from later evidence
 * on their own seed and are settled by a pass rather than by asking him;
 * judgments already have their own observation pass.
 *
 * Real world only. A rehearsal experiment is a rehearsal of grading too, and it
 * may not consume the owner's attention or move his hit rate.
 */
export async function awaitingAnswer(founderId: string): Promise<AwaitingAnswer[]> {
  return ((await query(
    `SELECT e.id, e.what_we_expect, e.would_disprove, e.decided_at, e.due_at,
            o.headline
       FROM venture_experiments e
       JOIN venture_opportunities o ON o.id = e.opportunity_id
       LEFT JOIN prediction_resolutions r
              ON r.kind = 'venture_experiment' AND r.prediction_id = e.id
      WHERE e.founder_id = ? AND e.decision = 'approved' AND e.ran_at IS NULL
        AND e.evidence_mode = 'real' AND r.id IS NULL
      ORDER BY COALESCE(e.due_at, e.decided_at), e.rowid`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const dueAt = r.due_at == null ? null : String(r.due_at);
    return {
      kind: 'venture_experiment' as const,
      predictionId: String(r.id),
      expected: String(r.what_we_expect),
      wouldDisprove: r.would_disprove == null ? null : String(r.would_disprove),
      predictedAt: String(r.decided_at ?? ''),
      dueAt,
      overdue: dueAt !== null && new Date(dueAt).getTime() <= Date.now(),
      about: String(r.headline),
    };
  });
}

/**
 * WHAT WAS READ, AND WHETHER THE READING HELD.
 *
 * An interpretation named what would show it had been misread, before any
 * confirming evidence existed. This is the pass that goes back and looks —
 * settled from evidence about the same seed, never from re-reading the same
 * sentence, because a model re-reading its own reading agrees with itself.
 *
 * Returns what it settled, so a job can say how much it did rather than that it
 * ran.
 */
export async function resolveWhatWasRead(founderId: string): Promise<Array<{
  interpretationId: string; verdict: Verdict; because: string;
}>> {
  const open = ((await query(
    `SELECT i.id, i.interpreted_at, i.misread_if, s.id AS seed_id
       FROM observation_interpretations i
       JOIN opportunity_seeds s ON s.interpretation_id = i.id
       LEFT JOIN prediction_resolutions r
              ON r.kind = 'observation_interpretation' AND r.prediction_id = i.id
      WHERE s.founder_id = ? AND s.evidence_mode = 'real' AND r.id IS NULL
      ORDER BY i.rowid`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>);

  const settled: Array<{ interpretationId: string; verdict: Verdict; because: string }> = [];
  for (const row of open) {
    const seedId = String(row.seed_id);
    const interpretedAt = String(row.interpreted_at);

    // A LATER READING OF THE SAME SEED THAT CONTRADICTS IT. The strongest signal
    // available without asking him, and it comes from a different source than
    // the one that produced the reading.
    const contradicted = (await query(
      `SELECT q.id FROM seed_questionings q
        WHERE q.seed_id = ? AND q.bearing = 'contradicts'
          AND datetime(q.asked_at) > datetime(?)
        ORDER BY q.rowid LIMIT 1`, [seedId, interpretedAt]))
      .rows[0] as Record<string, unknown> | undefined;

    if (contradicted) {
      const done = await resolvePrediction({
        founderId, kind: 'observation_interpretation', predictionId: String(row.id),
        resolvedBy: 'later_observation', evidenceRef: `seed_questioning:${String(contradicted.id)}`,
        verdict: 'surprised',
        because: 'a later way of knowing contradicted the reading this was built on',
        predictedAt: interpretedAt,
      });
      if ('id' in done) {
        settled.push({ interpretationId: String(row.id), verdict: 'surprised',
          because: 'contradicted by a later observation' });
      }
      continue;
    }

    // AND THE OTHER DIRECTION: the seed became a candidate, an experiment on it
    // ran, and the experiment was not surprised. That is the reading surviving
    // contact with behaviour, which is the only thing that could confirm it.
    const held = (await query(
      `SELECT e.id FROM venture_experiments e
        JOIN venture_opportunities o ON o.id = e.opportunity_id
       WHERE o.from_seed_id = ? AND e.verdict = 'as_predicted'
         AND datetime(e.ran_at) > datetime(?)
       ORDER BY e.rowid LIMIT 1`, [seedId, interpretedAt]))
      .rows[0] as Record<string, unknown> | undefined;

    if (held) {
      const done = await resolvePrediction({
        founderId, kind: 'observation_interpretation', predictionId: String(row.id),
        resolvedBy: 'experiment_result', evidenceRef: `venture_experiment:${String(held.id)}`,
        verdict: 'as_predicted',
        because: 'an experiment on what this reading produced came back as predicted',
        predictedAt: interpretedAt,
      });
      if ('id' in done) {
        settled.push({ interpretationId: String(row.id), verdict: 'as_predicted',
          because: 'an experiment built on it held' });
      }
    }
  }
  return settled;
}
