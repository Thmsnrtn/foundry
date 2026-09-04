// =============================================================================
// FOUNDRY - saying what you expect, before you look
//
// The step that turns a candidate's open questions into an answer, and the one
// place in the venture institution where something is deliberately made hard.
//
// AN EXPERIMENT MAY NOT BE PROPOSED WITHOUT A WAY TO BE WRONG. `wouldDisprove`
// is required, and it is not decoration: a test whose every possible outcome
// confirms the plan is a way of spending money to feel more certain. The
// institution exists partly to stop its owner doing that, and mostly to stop
// itself.
//
// AND ITS RESULT ENTERS EVIDENCE THROUGH THE ORDINARY DOOR. What comes back is
// filed as an observation like a forum thread or a pricing page - same source,
// same date, same bearing, same table. Its standing is not higher because
// Foundry ran it; the only privilege a prediction earns is having been on the
// record first.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { matchRealityOnly, observe, realityOnlyPatterns } from './market-evidence.js';

export interface Experiment {
  id: string;
  whatWeDo: string;
  whatWeExpect: string;
  wouldDisprove: string;
  costCents: number;
  question: string;
  decision: 'approved' | 'declined' | null;
  ranAt: string | null;
  whatHappened: string | null;
  verdict: 'as_predicted' | 'surprised' | null;
}

/**
 * DESIGN ONE, AGAINST A QUESTION THAT IS ACTUALLY OPEN.
 *
 * The unknown has to exist and be unanswered - the database enforces both -
 * because an experiment attached to no question is activity, and activity is
 * what a research function produces when nobody is checking whether it learned
 * anything.
 */
export async function designExperiment(input: {
  founderId: string; opportunityId: string; unknownId: string;
  claimId?: string | null;
  whatWeDo: string; whatWeExpect: string; wouldDisprove: string;
  costCents?: number;
  evidenceMode: 'real' | 'reference';
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO venture_experiments
       (id, founder_id, opportunity_id, unknown_id, claim_id, what_we_do,
        what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.opportunityId, input.unknownId,
      input.claimId ?? null, input.whatWeDo.trim(), input.whatWeExpect.trim(),
      input.wouldDisprove.trim(), input.costCents ?? 0, input.evidenceMode]);
  return id;
}

/**
 * WHAT IT WOULD COST HIM, AGAINST WHAT HE SAID HE WOULD SPEND.
 *
 * The budget lives in his own steering - "spend no more than $20 validating
 * it" - rather than in a company allowance, because at this point there is no
 * company. An experiment over the budget is not refused: it is shown to him as
 * over the budget, which is his sentence to reconsider rather than the
 * institution's to enforce silently.
 */
export async function overWhatHeSaid(input: {
  mandateId: string; costCents: number;
}): Promise<string | null> {
  const budget = (await query(
    `SELECT subject FROM venture_guidance
      WHERE mandate_id = ? AND kind = 'budget' AND superseded_by IS NULL
      ORDER BY rowid DESC LIMIT 1`, [input.mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!budget?.subject) return null;
  const capCents = Math.round(Number(budget.subject) * 100);
  if (!Number.isFinite(capCents) || input.costCents <= capCents) return null;
  return `this would cost $${(input.costCents / 100).toFixed(2)} and you said `
    + `to spend no more than $${(capCents / 100).toFixed(2)}`;
}

/** What is waiting on him, with the prediction he would be approving. */
export async function awaitingHim(opportunityId: string): Promise<Experiment[]> {
  return ((await query(
    `SELECT e.id, e.what_we_do, e.what_we_expect, e.would_disprove, e.cost_cents,
            e.decision, e.ran_at, e.what_happened, e.verdict, u.question
       FROM venture_experiments e
       JOIN market_unknowns u ON u.id = e.unknown_id
      WHERE e.opportunity_id = ? AND e.decision IS NULL
      ORDER BY e.rowid`, [opportunityId]))
    .rows as unknown as Array<Record<string, unknown>>).map(read);
}

/** Everything that has been decided about, run or not. */
export async function whatWasTried(opportunityId: string): Promise<Experiment[]> {
  return ((await query(
    `SELECT e.id, e.what_we_do, e.what_we_expect, e.would_disprove, e.cost_cents,
            e.decision, e.ran_at, e.what_happened, e.verdict, u.question
       FROM venture_experiments e
       JOIN market_unknowns u ON u.id = e.unknown_id
      WHERE e.opportunity_id = ? AND e.decision IS NOT NULL
      ORDER BY e.rowid`, [opportunityId]))
    .rows as unknown as Array<Record<string, unknown>>).map(read);
}

function read(r: Record<string, unknown>): Experiment {
  return {
    id: String(r.id), whatWeDo: String(r.what_we_do),
    whatWeExpect: String(r.what_we_expect), wouldDisprove: String(r.would_disprove),
    costCents: Number(r.cost_cents), question: String(r.question),
    decision: r.decision == null ? null : String(r.decision) as 'approved' | 'declined',
    ranAt: r.ran_at == null ? null : String(r.ran_at),
    whatHappened: r.what_happened == null ? null : String(r.what_happened),
    verdict: r.verdict == null ? null
      : String(r.verdict) as 'as_predicted' | 'surprised',
  };
}

export async function decideExperiment(input: {
  experimentId: string; decision: 'approved' | 'declined'; by: string;
}): Promise<{ workshop: string | null }> {
  await query(
    `UPDATE venture_experiments
        SET decision = ?, decided_at = datetime('now'), decided_by = ?
      WHERE id = ?`, [input.decision, input.by, input.experimentId]);
  if (input.decision !== 'approved') return { workshop: null };
  // AN APPROVED TEST GETS SOMEWHERE TO BE BUILT, under a ceiling that lets it
  // make things and never lets it reach the world on its own. When no real
  // computer is available the experiment stays approved and says so.
  const { workshopFor } = await import('../workshop/index.js');
  const made = await workshopFor(input.experimentId);
  return { workshop: made.opened ? made.workshopId : null };
}

/**
 * WHAT CAME BACK, AND WHETHER IT WAS WHAT WE SAID.
 *
 * `asPredicted` is stated by whoever ran it and stored alongside the sealed
 * prediction, so anybody can read both and disagree with the grading. That is
 * deliberate: an institution that scored its own predictions with no record of
 * what it predicted would always have been right.
 *
 * The result then becomes an ordinary observation, and answers the question it
 * was designed against - so an unknown closes because something happened,
 * rather than because somebody decided it had stopped mattering.
 */
export async function recordResult(input: {
  experimentId: string; whatHappened: string; asPredicted: boolean;
}): Promise<{ settled: string | null }> {
  const e = (await query(
    `SELECT founder_id, unknown_id, claim_id, what_we_expect, would_disprove,
            evidence_mode, decision
       FROM venture_experiments WHERE id = ?`, [input.experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) throw new Error('no such experiment');
  if (String(e.decision) !== 'approved') {
    throw new Error('venture_experiment:not_approved');
  }

  await query(
    `UPDATE venture_experiments
        SET ran_at = datetime('now'), what_happened = ?, verdict = ?
      WHERE id = ?`,
    [input.whatHappened.trim(), input.asPredicted ? 'as_predicted' : 'surprised',
      input.experimentId]);

  if (e.claim_id != null) {
    await observe({
      founderId: String(e.founder_id), claimId: String(e.claim_id),
      // WHICH KIND OF SOURCE THIS IS depends on the world it happened in, and
      // saying "landing page test" about something invented would let a
      // rehearsal result read as a real one.
      sourceType: String(e.evidence_mode) === 'reference'
        ? 'reference_world' : 'landing_page_test',
      source: `experiment:${input.experimentId}`,
      saw: input.whatHappened.trim(),
      // A SURPRISE CUTS AGAINST THE CLAIM. This is the line that makes the
      // whole apparatus capable of changing its mind: the same code path that
      // records a success records the thing that undermines it.
      bearing: input.asPredicted ? 'supports' : 'contradicts',
      directness: 'direct', observedAt: new Date(),
      evidenceMode: String(e.evidence_mode) as 'real' | 'reference',
    });
  }

  await query(
    `UPDATE market_unknowns SET answered_at = datetime('now'), answer = ?
      WHERE id = ? AND answered_at IS NULL`,
    [input.whatHappened.trim(), String(e.unknown_id)]);

  return { settled: e.claim_id == null ? null : String(e.claim_id) };
}

export interface WhereToLookNext {
  /** True while reading more could still change the next decision. */
  keepLooking: boolean;
  /** The one sentence. */
  because: string;
  /** Questions no amount of reading will settle, with what would. */
  onlyRealityCanSettle: Array<{
    question: string; onlySettledBy: string;
    /** What a result supporting the claim would look like. */
    looksLike: string;
    /** And what would mean we were wrong. */
    wouldBeWrongIf: string;
    /** The cheapest thing that would settle it, if anybody has named one. */
    cheapestTest: string | null;
  }>;
  /** Questions a source could still answer, and nobody has asked. */
  stillWorthReading: string[];
}

/**
 * WOULD MORE DESK RESEARCH CHANGE THE NEXT DECISION?
 *
 * The discipline that stops research becoming performance. Some questions no
 * amount of reading will answer — whether somebody will pay, switch, click, or
 * come back are answered by behaviour and by nothing else. When every question
 * standing in the way is one of those, another pile of evidence is worth less
 * than a five-dollar experiment, and saying so is the useful output.
 *
 * The list of what reading cannot settle is constitutional rather than
 * inferred, because it is a claim about the world: those questions belong to
 * behaviour, not to sources.
 */
export async function whereToLookNext(opportunityId: string): Promise<WhereToLookNext> {
  const open = ((await query(
    `SELECT question, blocking, cheapest_test FROM market_unknowns
      WHERE opportunity_id = ? AND answered_at IS NULL
      ORDER BY blocking DESC, rowid`, [opportunityId]))
    .rows as unknown as Array<Record<string, unknown>>);

  const patterns = await realityOnlyPatterns();

  const onlyRealityCanSettle: WhereToLookNext['onlyRealityCanSettle'] = [];
  const stillWorthReading: string[] = [];
  let blockingCount = 0;
  let blockingReadable = 0;

  for (const row of open) {
    const question = String(row.question);
    const blocking = Number(row.blocking) === 1;
    if (blocking) blockingCount += 1;
    const hit = matchRealityOnly(question, patterns);
    if (hit) {
      onlyRealityCanSettle.push({
        question, onlySettledBy: hit.onlySettledBy, looksLike: hit.looksLike,
        wouldBeWrongIf: hit.wouldBeWrongIf,
        cheapestTest: row.cheapest_test == null ? null : String(row.cheapest_test),
      });
    } else {
      stillWorthReading.push(question);
      if (blocking) blockingReadable += 1;
    }
  }

  if (open.length === 0) {
    return { keepLooking: false, onlyRealityCanSettle, stillWorthReading,
      because: 'nothing is open — there is no question left for reading to answer' };
  }
  if (blockingCount > 0 && blockingReadable === 0) {
    const first = onlyRealityCanSettle[0];
    return {
      keepLooking: false, onlyRealityCanSettle, stillWorthReading,
      because: 'everything standing in the way is a question about what people will '
        + `actually do. ${first ? `${first.question} is settled by ${first.onlySettledBy}` : ''}`
        + ' — another pile of reading would not change the next decision.',
    };
  }
  return {
    keepLooking: true, onlyRealityCanSettle, stillWorthReading,
    because: stillWorthReading.length === 1
      ? `one question is still worth reading about: ${stillWorthReading[0] ?? ''}`
      : `${String(stillWorthReading.length)} questions are still worth reading about`,
  };
}

/**
 * WHEN READING IS DONE, PROPOSE THE THING THAT WOULD SETTLE IT.
 *
 * The last step of the research chain, and the one that turns a good sentence
 * into an action. When every question in the way is about what people will
 * actually do, the institution stops reading and proposes the cheapest test
 * itself rather than waiting to be asked.
 *
 * IT STILL MAY NOT PROPOSE ANYTHING IT CANNOT BE WRONG ABOUT. The prediction is
 * not invented here: what a result looks like, and what would mean we were
 * wrong, are properties of the KIND of question and are stated
 * constitutionally. A question nobody could write those for is one an
 * experiment could not settle either, and it is skipped with the reason.
 *
 * AND IT PROPOSES, IT DOES NOT RUN. Everything here stops at a proposal with a
 * sealed prediction waiting for him — the experiment machinery already refuses
 * to run anything he has not approved, and this changes nothing about that.
 */
export async function proposeWhatRealityWouldSettle(input: {
  founderId: string; opportunityId: string; proposedBy?: string;
}): Promise<{ proposed: string[]; skipped: Array<{ question: string; because: string }> }> {
  const next = await whereToLookNext(input.opportunityId);
  const proposed: string[] = [];
  const skipped: Array<{ question: string; because: string }> = [];
  // Reading is still cheaper than acting. Nothing to propose.
  if (next.keepLooking) return { proposed, skipped };

  const evidenceMode = String(((await query(
    'SELECT evidence_mode FROM venture_opportunities WHERE id = ?', [input.opportunityId]))
    .rows[0] as Record<string, unknown> | undefined)?.evidence_mode ?? 'real');

  for (const question of next.onlyRealityCanSettle) {
    if (question.cheapestTest === null) {
      skipped.push({ question: question.question,
        because: 'nobody has named anything cheap that would settle it, and proposing '
          + 'a test without one would be proposing a cost with no shape' });
      continue;
    }
    const unknown = (await query(
      `SELECT id FROM market_unknowns
        WHERE opportunity_id = ? AND question = ? AND answered_at IS NULL`,
      [input.opportunityId, question.question])).rows[0] as Record<string, unknown> | undefined;
    if (!unknown) continue;

    // One open proposal per question. Asking twice for the same thing is how
    // an owner learns to stop reading.
    const already = (await query(
      `SELECT id FROM venture_experiments
        WHERE unknown_id = ? AND (decision IS NULL OR ran_at IS NULL)`,
      [String(unknown.id)])).rows[0];
    if (already) continue;

    proposed.push(await designExperiment({
      founderId: input.founderId, opportunityId: input.opportunityId,
      unknownId: String(unknown.id),
      whatWeDo: question.cheapestTest,
      whatWeExpect: question.looksLike,
      wouldDisprove: question.wouldBeWrongIf,
      // The cost is his to set when he approves: the institution proposes what
      // to do, never what to spend.
      costCents: 0,
      evidenceMode: evidenceMode === 'reference' ? 'reference' : 'real',
    }));
  }
  return { proposed, skipped };
}

/**
 * WHAT WOULD HAVE TO BE TRUE BEFORE THIS COULD BECOME A COMPANY.
 *
 * Not a score and not a readiness percentage. A list of the things still in the
 * way, each of which is a sentence he could act on - and an empty list is the
 * only thing that means ready.
 */
export async function whatStandsInTheWay(opportunityId: string): Promise<string[]> {
  const inTheWay: string[] = [];

  const blocking = ((await query(
    `SELECT question FROM market_unknowns
      WHERE opportunity_id = ? AND answered_at IS NULL AND blocking = 1`,
    [opportunityId])).rows as unknown as Array<Record<string, unknown>>)
    .map((r) => String(r.question));
  for (const q of blocking) inTheWay.push(`nobody knows ${q}`);

  // A CLAIM WITH EVIDENCE ON BOTH SIDES IS NOT A CLAIM YET.
  const contested = (await query(
    `SELECT c.claim FROM market_claims c
      WHERE c.opportunity_id = ? AND c.settled_as IS NULL
        AND EXISTS (SELECT 1 FROM market_observations o
                     WHERE o.claim_id = c.id AND o.bearing = 'contradicts')`,
    [opportunityId])).rows as unknown as Array<Record<string, unknown>>;
  for (const c of contested) {
    inTheWay.push(`something contradicts "${String(c.claim)}" and nothing has settled it`);
  }

  const failed = (await query(
    `SELECT claim FROM market_claims
      WHERE opportunity_id = ? AND settled_as = 'failed'`, [opportunityId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const c of failed) {
    inTheWay.push(`"${String(c.claim)}" was tested and did not hold`);
  }

  const untested = (await query(
    `SELECT COUNT(*) AS n FROM market_claims WHERE opportunity_id = ?`,
    [opportunityId])).rows[0] as Record<string, unknown>;
  if (Number(untested.n) === 0) {
    inTheWay.push('nothing has been claimed about it that could be checked');
  }

  // WHAT LIABILITY IT CREATES, before it can go anywhere. A candidate nobody
  // has asked that of, one that needs a qualified person to look, or one whose
  // legal picture is over six months old, waits - however good the rest reads.
  const owner = (await query(
    `SELECT founder_id, evidence_mode FROM venture_opportunities WHERE id = ?`,
    [opportunityId])).rows[0] as Record<string, unknown> | undefined;
  if (owner) {
    const { legalPictureOf } = await import('./legal-surface.js');
    const picture = await legalPictureOf({
      founderId: String(owner.founder_id), opportunityId,
      world: String(owner.evidence_mode) === 'reference' ? 'reference' : 'real' });
    inTheWay.push(...picture.inTheWay);
  }
  return inTheWay;
}

/**
 * ADVANCING IS HIS ACT, AND THE RECORD SAYS SO.
 *
 * Foundry can establish that nothing stands in the way. It does not turn a
 * candidate into a company: that is the decision the whole apparatus exists to
 * put in front of him, and an institution that took it would have spent his
 * money on its own conclusion.
 */
export async function advance(input: {
  opportunityId: string; by: string;
}): Promise<{ advanced: boolean; because: string }> {
  const inTheWay = await whatStandsInTheWay(input.opportunityId);
  if (inTheWay.length > 0) {
    return { advanced: false, because: inTheWay.join('; ') };
  }
  // The reason is required by the table and names who decided, because
  // "advanced" with no author is a verdict the record cannot attribute.
  await query(
    `UPDATE venture_opportunities
        SET verdict = 'advanced', verdict_why = ?, decided_at = datetime('now')
      WHERE id = ? AND verdict IS NULL`,
    [`${input.by} advanced it: nothing was left standing in the way`,
      input.opportunityId]);
  return {
    advanced: true,
    because: 'nothing is standing in the way any more. Making it a company is '
      + 'yours to do.',
  };
}
