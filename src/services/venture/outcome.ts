// =============================================================================
// FOUNDRY — the world settles the experiment
//
// THE MISSING LEG. An experiment's prediction was sealed at approval and could
// be settled by exactly one thing: the owner typing in what happened. That is
// the owner's judgment standing in for reality — a rehearsal of the return
// leg, not the return leg. Here a business outcome comes in from a provider,
// lands against the exposure it belongs to, and the rule sealed with the
// prediction is applied to it by code that has no opinion.
//
// THREE THINGS KEPT APART, AND TWO AXES.
//   EXPOSURE    where an offer was actually placed for an experiment.
//   EVENT       what a provider said happened there. Kinds closed; no payer
//               identity ever stored; counterparty classified by control path.
//   SETTLEMENT  the sealed rule applied to the events. `business_outcome`, not
//               the owner's opinion and not the model's.
//
//   VALIDITY ≠ VERDICT. A checkout that never worked did not test willingness
//   to pay; a market that said no did. Only a MEASUREMENT-CRITICAL execution
//   act resolved 'surprised' can invalidate the market inference, and which
//   acts are critical is sealed when the test is decided. An incidental
//   surprise settles on its own and changes nothing about the market verdict.
//
// WHAT "UNMATCHED EXTERNAL" MEANS. A real-mode provider supplied a payer
// reference that matched no identity the owner registered as his own or
// internal. That is all it means. It is not a stranger: the evidence cannot
// establish social independence, and nothing here pretends it can. No further
// identity is collected to try.
// =============================================================================

import { createHmac } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { earnAsset, retireExperimentalAsset } from './asset.js';
import { observe } from './market-evidence.js';

export type OutcomeWorld = 'real' | 'sandbox' | 'reference';
export type Counterparty =
  | 'unmatched_external' | 'owner' | 'internal' | 'reference' | 'sandbox'
  | 'test' | 'known_invalid' | 'unknown';

/**
 * THE RULE SEALED WITH THE PREDICTION. "At least N of EVENT, out of at most M
 * of OUT_OF, within D days of the offer being placed." Stored as JSON on the
 * experiment; parsed here and nowhere else.
 */
export interface SettlementRule {
  event: string;
  atLeast: number;
  outOf?: string;
  atMost?: number;
  withinDays: number;
}

export function parseSettlementRule(raw: unknown): SettlementRule | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const event = typeof o.event === 'string' ? o.event : null;
    const atLeast = typeof o.at_least === 'number' ? o.at_least : null;
    const withinDays = typeof o.within_days === 'number' ? o.within_days : null;
    if (event === null || atLeast === null || withinDays === null) return null;
    if (atLeast < 1 || withinDays < 1) return null;
    const rule: SettlementRule = { event, atLeast, withinDays };
    if (typeof o.out_of === 'string') rule.outOf = o.out_of;
    if (typeof o.at_most === 'number') rule.atMost = o.at_most;
    return rule;
  } catch {
    return null;
  }
}

export function settlementRuleJson(rule: SettlementRule): string {
  return JSON.stringify({
    event: rule.event, at_least: rule.atLeast,
    ...(rule.outOf === undefined ? {} : { out_of: rule.outOf }),
    ...(rule.atMost === undefined ? {} : { at_most: rule.atMost }),
    within_days: rule.withinDays,
  });
}

// ─── Where the offer was placed ───────────────────────────────────────────────

export async function placeExposure(input: {
  experimentId: string; productId?: string | null; provider: string; exposureRef: string;
  evidenceMode: OutcomeWorld; placedBy: string;
}): Promise<{ id: string } | { refused: string }> {
  const e = (await query(
    'SELECT founder_id FROM venture_experiments WHERE id = ?', [input.experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) return { refused: 'no such experiment' };
  // AN OFFER IN THE REAL WORLD HAS A STATED SHAPE, AND THE SHAPE HAS BEEN
  // READ. The asset-level pass is what turns "unknown" structural facts into
  // answers; placing the offer before it has run would put the first-proof
  // policy's verdicts on a page nothing consulted.
  if (input.evidenceMode === 'real' && input.productId != null) {
    const shape = (await query(
      `SELECT 1 FROM offer_shapes WHERE product_id = ? AND superseded_at IS NULL`, [input.productId])).rows[0];
    if (!shape) return { refused: 'the offer has no stated shape; state it, let the pass read it, then place it' };
    const { legalPictureOf } = await import('./legal-surface.js');
    const picture = await legalPictureOf({ founderId: String(e.founder_id), opportunityId: input.productId,
      world: 'real', subjectKind: 'company' });
    if (picture.inTheWay.length > 0) {
      return { refused: `the asset's legal picture stands in the way: ${picture.inTheWay.join('; ')}` };
    }
  }
  const id = nanoid();
  try {
    await query(
      `INSERT INTO experiment_exposures
         (id, founder_id, experiment_id, product_id, provider, exposure_ref, evidence_mode, placed_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, String(e.founder_id), input.experimentId, input.productId ?? null,
        input.provider.trim(), input.exposureRef.trim(), input.evidenceMode, input.placedBy]);
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
  return { id };
}

export async function withdrawExposure(exposureId: string): Promise<void> {
  await query(
    `UPDATE experiment_exposures SET withdrawn_at = datetime('now')
      WHERE id = ? AND withdrawn_at IS NULL`, [exposureId]);
}

// ─── Who the owner is, to a provider, without storing who he is ───────────────

/** HMAC-SHA256 of a provider-side reference under a key derived for this one
 * purpose from the server's encryption key. Never the value; never unkeyed —
 * an unkeyed hash of a low-entropy customer id is the id with extra steps. */
export function counterpartyHmac(provider: string, reference: string): string {
  const root = process.env.ENCRYPTION_KEY;
  if (!root) throw new Error('ENCRYPTION_KEY is required to classify a counterparty');
  const key = createHmac('sha256', root).update('foundry:counterparty:v1').digest();
  return createHmac('sha256', key)
    .update(`${provider.trim().toLowerCase()}:${reference.trim().toLowerCase()}`)
    .digest('hex');
}

/**
 * THE OWNER REGISTERS AN IDENTITY AS HIS OWN, OR INTERNAL, OR A TEST ACCOUNT.
 * Only a person can: an institution that could declare a counterparty internal
 * could also declare one external.
 */
export async function registerInternalCounterparty(input: {
  founderId: string; provider: string; reference: string;
  relation: 'owner' | 'internal' | 'test'; by: string;
}): Promise<{ id: string } | { refused: string }> {
  const id = nanoid();
  try {
    await query(
      `INSERT INTO internal_counterparties
         (id, founder_id, provider, relation, reference_hmac, registered_by)
       VALUES (?,?,?,?,?,?)`,
      [id, input.founderId, input.provider.trim(), input.relation,
        counterpartyHmac(input.provider, input.reference), input.by]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return { id: 'already' };
    return { refused: msg };
  }
  return { id };
}

async function classify(input: {
  founderId: string; provider: string; evidenceMode: OutcomeWorld; payerReference: string | null;
}): Promise<Counterparty> {
  // FORCED BY MODE. A rehearsal never carries an external counterparty; a
  // sandbox cannot either.
  if (input.evidenceMode === 'reference') return 'reference';
  if (input.evidenceMode === 'sandbox') return 'sandbox';
  // No reference at all: the provider could not say. Unknown, and unknown
  // never counts as anybody.
  if (input.payerReference === null || input.payerReference.trim() === '') return 'unknown';
  const known = (await query(
    `SELECT relation FROM internal_counterparties
      WHERE founder_id = ? AND provider = ? AND reference_hmac = ? AND retired_at IS NULL`,
    [input.founderId, input.provider.trim(), counterpartyHmac(input.provider, input.payerReference)]))
    .rows[0] as Record<string, unknown> | undefined;
  if (known) return String(known.relation) as Counterparty;
  return 'unmatched_external';
}

// ─── What the provider said happened ──────────────────────────────────────────

/**
 * RECORD WHAT A PROVIDER SAID HAPPENED AT AN EXPOSURE. Idempotent on the
 * provider's own reference. The payer reference is used to classify the
 * counterparty and then dropped: it is not stored, hashed or logged.
 */
export async function recordBusinessOutcome(input: {
  exposureId: string; kind: string; amountCents?: number | null; currency?: string;
  observedAt: Date; provider: string; providerRef: string;
  payerReference?: string | null; arrivedVia?: string | null;
}): Promise<{ id: string; counterparty: Counterparty; duplicate: boolean } | { refused: string }> {
  const x = (await query(
    `SELECT founder_id, evidence_mode, withdrawn_at FROM experiment_exposures WHERE id = ?`,
    [input.exposureId])).rows[0] as Record<string, unknown> | undefined;
  if (!x) return { refused: 'no such exposure' };
  const existing = (await query(
    `SELECT id, counterparty FROM business_outcome_events WHERE provider = ? AND provider_event_ref = ?`,
    [input.provider.trim(), input.providerRef.trim()])).rows[0] as Record<string, unknown> | undefined;
  if (existing) {
    return { id: String(existing.id), counterparty: String(existing.counterparty) as Counterparty,
      duplicate: true };
  }
  const evidenceMode = String(x.evidence_mode) as OutcomeWorld;
  const counterparty = await classify({
    founderId: String(x.founder_id), provider: input.provider, evidenceMode,
    payerReference: input.payerReference ?? null });
  const id = nanoid();
  try {
    await query(
      `INSERT INTO business_outcome_events
         (id, founder_id, exposure_id, kind, amount_cents, currency, observed_at, provider,
          provider_event_ref, evidence_mode, counterparty, arrived_via)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, String(x.founder_id), input.exposureId, input.kind, input.amountCents ?? null,
        input.currency ?? 'usd', input.observedAt.toISOString(), input.provider.trim(),
        input.providerRef.trim(), evidenceMode, counterparty, input.arrivedVia ?? null]);
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
  return { id, counterparty, duplicate: false };
}

// ─── Acts belong to their experiment ──────────────────────────────────────────

/**
 * BIND AN EXECUTION ACT TO THE EXPERIMENT IT SERVES, AND SAY WHETHER A FAILURE
 * THERE WOULD DESTROY THE MEASUREMENT. Sealed once the experiment is decided.
 */
export async function bindActToExperiment(input: {
  actId: string; experimentId: string; measurementCritical: boolean;
}): Promise<{ bound: true } | { refused: string }> {
  try {
    const r = await query(
      `UPDATE proposed_acts SET experiment_id = ?, measurement_critical = ? WHERE id = ?`,
      [input.experimentId, input.measurementCritical ? 1 : 0, input.actId]);
    if (r.rowsAffected === 0) return { refused: 'no such act' };
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
  return { bound: true };
}

export type InvalidityKind =
  | 'offer_not_published' | 'checkout_broken' | 'analytics_absent'
  | 'delivery_failed_before_exposure' | 'provider_outage' | 'instrumentation_defect'
  | 'wrong_audience_by_error';

/**
 * THE TEST DID NOT MEASURE WHAT IT WAS FOR. Two doors:
 *
 *   an ACT: only a measurement-critical act of this experiment whose own
 *   prediction resolved 'surprised' can invalidate it. A surprise on an
 *   incidental act is refused here — it settled on its own, as every
 *   operational prediction does, and says nothing about the market.
 *
 *   the OWNER: he may say the measurement was wrong, with its kind, and the
 *   record names him. This is his judgment, and it is recorded as that.
 *
 * Neither door produces a market verdict. An invalid test is re-run, not read.
 */
export async function invalidateExperiment(input: {
  experimentId: string; because: InvalidityKind; by: string; actId?: string | null;
}): Promise<{ invalidated: true } | { refused: string }> {
  // ONLY A MEASUREMENT-CRITICAL ACT THAT WAS APPROVED, EXECUTED AND RESOLVED
  // 'SURPRISED' BY SOMETHING OTHER THAN AN OPINION. Not an act inserted after
  // the fact, not one never run, not one the owner graded himself. And there
  // is no owner door: the owner's rule is that only measurement failure
  // invalidates a market inference, and his judgment that the measurement was
  // wrong is recorded, if at all, as an act's resolution like any other.
  if (input.actId == null) {
    return { refused: 'only a failed measurement-critical act invalidates a test; name the act' };
  }
  const act = (await query(
    `SELECT a.experiment_id, a.measurement_critical, a.decision, a.consumed_at,
            (SELECT verdict FROM prediction_resolutions r
              WHERE r.kind = 'proposed_act' AND r.prediction_id = a.id) AS verdict,
            (SELECT resolved_by FROM prediction_resolutions r
              WHERE r.kind = 'proposed_act' AND r.prediction_id = a.id) AS resolved_by
       FROM proposed_acts a WHERE a.id = ?`, [input.actId])).rows[0] as Record<string, unknown> | undefined;
  if (!act) return { refused: 'no such act' };
  if (String(act.experiment_id ?? '') !== input.experimentId) {
    return { refused: 'that act does not belong to this experiment' };
  }
  if (Number(act.measurement_critical) !== 1) {
    return { refused: 'that act was not measurement-critical: its surprise settles on its own and '
      + 'says nothing about whether the market was asked' };
  }
  if (act.decision !== 'approved' || act.consumed_at == null) {
    return { refused: 'that act was never approved and executed; a plan that did not run did not break' };
  }
  if (act.verdict !== 'surprised') {
    return { refused: 'that act did not fail: nothing about the measurement is in doubt' };
  }
  if (act.resolved_by === 'owner') {
    return { refused: 'that act was graded by the owner\'s opinion, and an opinion cannot invalidate '
      + 'what the world measured; it needs a later observation or a business outcome' };
  }
  try {
    const r = await query(
      `UPDATE venture_experiments
          SET validity = 'invalid', invalid_because = ?, invalidated_by = ?,
              invalidated_at = datetime('now')
        WHERE id = ?`,
      [input.because, `act:${input.actId}`, input.experimentId]);
    if (r.rowsAffected === 0) return { refused: 'no such experiment' };
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
  // The exposure comes down: an offer whose measurement is broken should not
  // keep collecting events that will never count.
  await query(
    `UPDATE experiment_exposures SET withdrawn_at = datetime('now')
      WHERE experiment_id = ? AND withdrawn_at IS NULL`, [input.experimentId]);
  return { invalidated: true };
}

/**
 * RUN IT AGAIN. A re-run of an invalid test needs nothing but the decision; a
 * re-run after a valid contradiction needs the claim revised first, and the
 * database refuses otherwise. The new experiment is undecided: he approves it
 * again, and the prediction is sealed again.
 */
export async function rerunExperiment(input: {
  experimentId: string; whatWeDo?: string; whatWeExpect?: string; wouldDisprove?: string;
  settlesWhen?: SettlementRule | null; costCents?: number;
}): Promise<{ id: string } | { refused: string }> {
  const o = (await query(
    `SELECT founder_id, opportunity_id, unknown_id, claim_id, what_we_do, what_we_expect,
            would_disprove, cost_cents, evidence_mode, settles_when
       FROM venture_experiments WHERE id = ?`, [input.experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!o) return { refused: 'no such experiment' };
  const original = (await query(
    `SELECT validity, verdict, ran_at FROM venture_experiments WHERE id = ?`, [input.experimentId]))
    .rows[0] as Record<string, unknown>;
  let unknownId = String(o.unknown_id);
  let claimId = o.claim_id == null ? null : String(o.claim_id);
  if (String(original.validity) === 'invalid') {
    // THE WORLD WAS NEVER ASKED. The question the broken test closed is open
    // again, exactly as it was.
    await query(
      `UPDATE market_unknowns SET answered_at = NULL, answer = NULL
        WHERE id = ? AND answered_at IS NOT NULL`, [unknownId]);
  } else if (original.verdict === 'surprised' && claimId !== null) {
    // THE WORLD SAID NO TO THAT CLAIM. What was answered stays answered; the
    // re-run tests the NARROWER claim the contradiction produced, and asks the
    // same question of it as a new, open unknown. If the claim has not been
    // revised the database refuses the re-run below, in its own words.
    const narrower = (await query(
      `SELECT revised_into FROM market_claims WHERE id = ? AND revised_at IS NOT NULL
          AND datetime(revised_at) > datetime(?)`, [claimId, String(original.ran_at)]))
      .rows[0] as Record<string, unknown> | undefined;
    if (narrower?.revised_into != null) {
      claimId = String(narrower.revised_into);
      const old = (await query(
        `SELECT question, cheapest_test FROM market_unknowns WHERE id = ?`, [unknownId]))
        .rows[0] as Record<string, unknown>;
      unknownId = nanoid();
      await query(
        `INSERT INTO market_unknowns (id, founder_id, opportunity_id, claim_id, question, blocking, cheapest_test)
         VALUES (?,?,?,?,?,1,?)`,
        [unknownId, String(o.founder_id), String(o.opportunity_id), claimId,
          String(old.question), old.cheapest_test == null ? null : String(old.cheapest_test)]);
    }
  }
  const id = nanoid();
  try {
    await query(
      `INSERT INTO venture_experiments
         (id, founder_id, opportunity_id, unknown_id, claim_id, what_we_do, what_we_expect,
          would_disprove, cost_cents, evidence_mode, settles_when, rerun_of)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, String(o.founder_id), String(o.opportunity_id), unknownId, claimId,
        (input.whatWeDo ?? String(o.what_we_do)).trim(),
        (input.whatWeExpect ?? String(o.what_we_expect)).trim(),
        (input.wouldDisprove ?? String(o.would_disprove)).trim(),
        input.costCents ?? Number(o.cost_cents), String(o.evidence_mode),
        input.settlesWhen === undefined
          ? (o.settles_when == null ? null : String(o.settles_when))
          : input.settlesWhen === null ? null : settlementRuleJson(input.settlesWhen),
        input.experimentId]);
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
  return { id };
}

// ─── Settlement ───────────────────────────────────────────────────────────────

/** Whether an event of this counterparty may count toward a market verdict. */
function counts(counterparty: string, world: OutcomeWorld, forThePaidEvent: boolean): boolean {
  if (world === 'reference') return counterparty === 'reference';
  if (world === 'sandbox') return false;
  // INTERNAL ACTIVITY DOES NOT PROVE MARKET VALUE. The owner's own payment,
  // a collaborator's, a test account's: none of them count, ever.
  if (['owner', 'internal', 'test', 'known_invalid', 'sandbox', 'reference'].includes(counterparty)) return false;
  // An arrival nobody could identify still counts as an arrival. A PAYMENT
  // nobody could classify does not count as a payment: the one thing this
  // leg exists to establish is that the money was not the owner's, and
  // 'unknown' cannot say so.
  return forThePaidEvent ? counterparty === 'unmatched_external' : true;
}

export interface Settlement {
  settled: 'as_predicted' | 'partly' | 'surprised' | null;
  because: string;
  earned: boolean;
  counted: { event: number; outOf: number | null; uncounted: number };
}

/**
 * APPLY THE SEALED RULE TO WHAT THE WORLD DID. No opinion enters: the rule was
 * approved with the prediction, the events came from a provider, and the code
 * here only counts. Settles the prediction by `business_outcome`, answers the
 * unknown, records the observation against the claim, and — if somebody
 * unmatched paid and received — lets reality earn the asset.
 */
export async function settleFromTheWorld(experimentId: string, now = new Date()): Promise<Settlement> {
  const e = (await query(
    `SELECT e.founder_id, e.unknown_id, e.claim_id, e.decision, e.decided_at, e.ran_at,
            e.validity, e.evidence_mode, e.settles_when, e.what_we_expect,
            x.id AS exposure_id, x.placed_at, x.product_id
       FROM venture_experiments e
       LEFT JOIN experiment_exposures x ON x.experiment_id = e.id AND x.withdrawn_at IS NULL
      WHERE e.id = ?`, [experimentId])).rows[0] as Record<string, unknown> | undefined;
  const none = (because: string): Settlement =>
    ({ settled: null, because, earned: false, counted: { event: 0, outOf: null, uncounted: 0 } });
  if (!e) return none('no such experiment');
  if (String(e.decision ?? '') !== 'approved') return none('not approved');
  if (String(e.validity) === 'invalid') return none('the test is invalid; it is re-run, not read');
  if (e.ran_at != null) return none('already settled');
  const rule = parseSettlementRule(e.settles_when);
  if (rule === null) return none('no settlement rule was sealed with the prediction; only the owner can settle it');
  if (e.exposure_id == null) return none('the offer has not been placed anywhere');
  const world = String(e.evidence_mode) as OutcomeWorld;
  const placedAt = new Date(String(e.placed_at).replace(' ', 'T') + (String(e.placed_at).endsWith('Z') ? '' : 'Z'));
  const closesAt = new Date(placedAt.getTime() + rule.withinDays * 86_400_000);

  const rows = (await query(
    `SELECT kind, counterparty, amount_cents, observed_at FROM business_outcome_events
      WHERE exposure_id = ? AND datetime(observed_at) >= datetime(?) AND datetime(observed_at) <= datetime(?)
      ORDER BY observed_at`, [String(e.exposure_id), placedAt.toISOString(), closesAt.toISOString()]))
    .rows as unknown as Array<Record<string, unknown>>;
  let event = 0;
  let outOf = 0;
  let uncounted = 0;
  let metAt: string | null = null;
  let disprovedAt: string | null = null;
  for (const r of rows) {
    const kind = String(r.kind);
    const cp = String(r.counterparty);
    if (kind === rule.event) {
      if (counts(cp, world, true)) event += 1; else uncounted += 1;
    }
    if (rule.outOf !== undefined && kind === rule.outOf && counts(cp, world, false)) outOf += 1;
    if (metAt === null && event >= rule.atLeast) metAt = String(r.observed_at);
    if (disprovedAt === null && metAt === null && rule.atMost !== undefined && outOf > rule.atMost) {
      disprovedAt = String(r.observed_at);
    }
  }
  const counted = { event, outOf: rule.outOf === undefined ? null : outOf, uncounted };
  const windowClosed = now.getTime() >= closesAt.getTime();

  // WHICHEVER THE WORLD DID FIRST DECIDES, so the answer does not depend on
  // when the tick happened to run. Thirty-one arrivals and then a payment is a
  // disproved prediction that later got a sale; a payment and then thirty-one
  // arrivals is a prediction that held.
  let verdict: 'as_predicted' | 'partly' | 'surprised' | null = null;
  if (metAt !== null && (disprovedAt === null || metAt <= disprovedAt)) verdict = 'as_predicted';
  else if (disprovedAt !== null) verdict = 'surprised';
  else if (windowClosed) verdict = event > 0 ? 'partly' : 'surprised';
  if (verdict === null) {
    return { settled: null, earned: false, counted,
      because: `${String(event)} of ${String(rule.atLeast)} ${rule.event} so far`
        + (rule.outOf === undefined ? '' : ` out of ${String(outOf)} ${rule.outOf}`)
        + `; the window closes ${closesAt.toISOString().slice(0, 10)}` };
  }

  const because = `${String(event)} ${rule.event}${event === 1 ? '' : 's'} that counted`
    + (rule.outOf === undefined ? '' : ` out of ${String(outOf)} ${rule.outOf}${outOf === 1 ? '' : 's'}`)
    + ` within ${String(rule.withinDays)} days; the rule asked for at least ${String(rule.atLeast)}`
    + (rule.atMost === undefined ? '' : ` out of at most ${String(rule.atMost)}`)
    + (uncounted > 0 ? `; ${String(uncounted)} ${rule.event}${uncounted === 1 ? '' : 's'} did not count `
      + '(the owner\'s own, internal, a test account, or nobody the provider could say)' : '')
    + `. ${verdict === 'as_predicted' ? 'As predicted.' : verdict === 'partly' ? 'Partly: some, fewer than predicted.' : 'Not as predicted.'}`;

  // THE ROW. The column admits two words; 'partly' is not as predicted and is
  // written as such, with the grade carrying the finer distinction.
  await query(
    `UPDATE venture_experiments SET ran_at = ?, what_happened = ?, verdict = ? WHERE id = ?`,
    [now.toISOString(), because, verdict === 'as_predicted' ? 'as_predicted' : 'surprised', experimentId]);
  await query(
    `UPDATE market_unknowns SET answered_at = datetime('now'), answer = ? WHERE id = ? AND answered_at IS NULL`,
    [because, String(e.unknown_id)]);
  if (e.claim_id != null) {
    await observe({
      founderId: String(e.founder_id), claimId: String(e.claim_id),
      sourceType: world === 'reference' ? 'reference_world' : 'provider_api',
      source: `experiment_exposure:${String(e.exposure_id)}`, saw: because,
      bearing: verdict === 'surprised' ? 'contradicts' : 'supports',
      directness: 'direct', observedAt: now, evidenceMode: world,
    });
  }
  // THE GRADE, BY THE WORLD. The reference world is not graded: a rehearsal
  // of the return leg may not move a hit rate the owner will rely on.
  if (world === 'real' && e.decided_at != null) {
    const { resolvePrediction } = await import('../institution/calibration.js');
    await resolvePrediction({
      founderId: String(e.founder_id), kind: 'venture_experiment', predictionId: experimentId,
      resolvedBy: 'business_outcome', evidenceRef: `experiment_exposure:${String(e.exposure_id)}`,
      verdict, because, predictedAt: String(e.decided_at),
    });
  }

  // AND IF SOMEBODY UNMATCHED PAID AND RECEIVED, REALITY HAS RECOGNISED THE
  // ASSET. Earned means that and only that.
  let earned = false;
  if (verdict !== 'surprised' && e.product_id != null && world === 'real') {
    const closed = await paidAndReceived(String(e.exposure_id), world);
    if (closed) {
      const r = await earnAsset({ productId: String(e.product_id),
        by: `business_outcome:${String(e.exposure_id)}`, because });
      earned = r.earned;
    }
  }
  return { settled: verdict, because, earned, counted };
}

async function paidAndReceived(exposureId: string, world: OutcomeWorld): Promise<boolean> {
  // PAID MEANS STILL PAID. Money that went back, or is contested, is not a
  // stranger's money kept; the ledger records refunds and disputes and this
  // is where they are read.
  const r = (await query(
    `SELECT
       (SELECT COUNT(*) FROM business_outcome_events b JOIN business_outcome_event_kinds k ON k.kind = b.kind
         WHERE b.exposure_id = ? AND k.is_payment = 1 AND b.counterparty = ?) AS paid,
       (SELECT COUNT(*) FROM business_outcome_events b JOIN business_outcome_event_kinds k ON k.kind = b.kind
         WHERE b.exposure_id = ? AND k.is_delivery = 1) AS delivered,
       (SELECT COUNT(*) FROM business_outcome_events b
         WHERE b.exposure_id = ? AND b.kind IN ('refund','dispute')) AS reversed`,
    [exposureId, world === 'reference' ? 'reference' : 'unmatched_external', exposureId, exposureId]))
    .rows[0] as Record<string, unknown>;
  return Number(r.paid) > 0 && Number(r.delivered) > 0 && Number(r.reversed) === 0;
}

// ─── The milestone, bounded ───────────────────────────────────────────────────

export interface FirstClosure {
  reached: boolean;
  /** The strongest sentence the evidence supports, and never stronger. */
  sentence: string;
  experimentId: string | null;
  productId: string | null;
}

/**
 * FIRST ECONOMIC CLOSURE: an owner mandate, a test he approved, an unmatched
 * external counterparty who paid and received, and a prediction the world
 * settled. Read from the ledger, never asserted. Real world only.
 */
export async function firstClosureOf(founderId: string): Promise<FirstClosure> {
  const r = (await query(
    `SELECT e.id AS experiment_id, x.product_id, x.id AS exposure_id,
            (SELECT SUM(b.amount_cents) FROM business_outcome_events b
              JOIN business_outcome_event_kinds k ON k.kind = b.kind
              WHERE b.exposure_id = x.id AND k.is_payment = 1 AND b.counterparty = 'unmatched_external') AS paid_cents,
            (SELECT COUNT(*) FROM business_outcome_events b
              JOIN business_outcome_event_kinds k ON k.kind = b.kind
              WHERE b.exposure_id = x.id AND k.is_delivery = 1) AS delivered,
            (SELECT COUNT(*) FROM prediction_resolutions p
              WHERE p.kind = 'venture_experiment' AND p.prediction_id = e.id
                AND p.resolved_by = 'business_outcome' AND p.verdict IN ('as_predicted','partly')) AS settled,
            (SELECT COUNT(*) FROM business_outcome_events b
              WHERE b.exposure_id = x.id AND b.kind IN ('refund','dispute')) AS reversed
       FROM venture_experiments e
       JOIN experiment_exposures x ON x.experiment_id = e.id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.validity = 'valid'
        AND x.evidence_mode = 'real'
      ORDER BY e.ran_at IS NULL, e.ran_at`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const closed = r.find((row) => Number(row.paid_cents ?? 0) > 0 && Number(row.delivered) > 0
    && Number(row.settled) > 0 && Number(row.reversed) === 0);
  if (closed) {
    const dollars = (Number(closed.paid_cents) / 100).toFixed(2);
    return { reached: true, experimentId: String(closed.experiment_id),
      productId: closed.product_id == null ? null : String(closed.product_id),
      sentence: `Somebody the provider could not match to you paid $${dollars} and received what they paid `
        + 'for, and the prediction settled on it. That is an unmatched external counterparty, not a proven '
        + 'stranger; and an asset that exists, not a business.' };
  }
  const paid = r.find((row) => Number(row.paid_cents ?? 0) > 0);
  if (paid) {
    return { reached: false, experimentId: String(paid.experiment_id),
      productId: paid.product_id == null ? null : String(paid.product_id),
      sentence: Number(paid.delivered) > 0
        ? 'Somebody unmatched paid and received; the prediction has not settled yet.'
        : 'Somebody unmatched paid; nothing says they received what they paid for yet.' };
  }
  if (r.length > 0) {
    return { reached: false, experimentId: String(r[0]?.experiment_id ?? ''),
      productId: r[0]?.product_id == null ? null : String(r[0].product_id),
      sentence: 'An offer is in the world; nobody unmatched has paid yet.' };
  }
  return { reached: false, experimentId: null, productId: null,
    sentence: 'No offer has been placed in the world yet.' };
}

// ─── What the tick does ───────────────────────────────────────────────────────

/** Approved, valid, unsettled experiments with a sealed rule and a live exposure. */
export async function whatTheWorldOwes(): Promise<string[]> {
  return ((await query(
    `SELECT e.id FROM venture_experiments e
       JOIN experiment_exposures x ON x.experiment_id = e.id AND x.withdrawn_at IS NULL
      WHERE e.decision = 'approved' AND e.validity = 'valid' AND e.ran_at IS NULL
        AND e.settles_when IS NOT NULL
      ORDER BY x.placed_at`, []))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.id));
}

/**
 * A TEST THAT FAILED, VALIDLY, RETIRES ITS ASSET AFTER THE GRACE THE POLICY
 * GIVES IT. Policy, not constitution: `failed_test_grace_days` is a row the
 * owner can supersede. The days are read from his live policy, never from
 * code. Nothing is deleted: the asset is archived with the reason on it.
 */
export async function retireWhatFailed(now = new Date()): Promise<string[]> {
  const retired: string[] = [];
  // WORK, NOT AN ANSWER: this is the tick's work-list, and the reference
  // world's failed rehearsal assets retire by the same rule so the rule is
  // exercised. Nothing here reaches the owner as his own or spends anything;
  // the retirement is an archive with the reason on it.
  const due = (await query(
    `SELECT p.id, p.owner_id, e.ran_at, e.what_happened FROM products p
       JOIN venture_experiments e ON e.id = p.from_experiment_id
      WHERE p.standing = 'experimental' AND p.status = 'active' AND p.deleted_at IS NULL
        AND e.validity = 'valid' AND e.verdict = 'surprised' AND e.ran_at IS NOT NULL
        -- 'partly' rides on the row as 'surprised'; the grade says some paid.
        AND NOT EXISTS (SELECT 1 FROM prediction_resolutions g
                         WHERE g.kind = 'venture_experiment' AND g.prediction_id = e.id AND g.verdict = 'partly')
        AND NOT EXISTS (SELECT 1 FROM venture_experiments r
                         WHERE r.rerun_of = e.id AND r.ran_at IS NULL AND r.validity = 'valid'
                           AND coalesce(r.decision,'') <> 'declined')`, []))
    .rows as unknown as Array<Record<string, unknown>>;
  const { originationPolicyFor } = await import('./legal-surface.js');
  for (const row of due) {
    const policy = await originationPolicyFor(String(row.owner_id));
    const grace = Number(policy.find((p) => p.requirement === 'failed_test_grace_days')?.value ?? 30);
    // A GRACE THAT IS NOT A NUMBER GRANTS NO ARCHIVE. Nothing retires on a
    // blank; the row waits until the policy says a number.
    if (!Number.isFinite(grace) || grace < 0) continue;
    const ranAt = Date.parse(String(row.ran_at));
    if (Number.isNaN(ranAt) || now.getTime() - ranAt < grace * 86_400_000) continue;
    const ok = await retireExperimentalAsset({ productId: String(row.id),
      because: `its test did not hold and ${String(grace)} days passed with no re-run: ${String(row.what_happened)}` });
    if (ok) retired.push(String(row.id));
  }
  return retired;
}

// ─── Reading the ledger back ──────────────────────────────────────────────────

/** Where an experiment's offer is, or was. */
export async function exposureOf(experimentId: string): Promise<{
  id: string; provider: string; exposureRef: string; placedAt: string; placedBy: string;
  withdrawnAt: string | null; world: OutcomeWorld;
} | null> {
  const r = (await query(
    `SELECT id, provider, exposure_ref, placed_at, placed_by, withdrawn_at, evidence_mode
       FROM experiment_exposures WHERE experiment_id = ?
      ORDER BY withdrawn_at IS NOT NULL, placed_at DESC LIMIT 1`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return { id: String(r.id), provider: String(r.provider), exposureRef: String(r.exposure_ref),
    placedAt: String(r.placed_at), placedBy: String(r.placed_by),
    withdrawnAt: r.withdrawn_at == null ? null : String(r.withdrawn_at),
    world: String(r.evidence_mode) as OutcomeWorld };
}

/** What the world did at an exposure, in order, with no payer in it. */
export async function whatTheWorldSaid(exposureId: string): Promise<Array<{
  kind: string; whatItIs: string; amountCents: number | null; currency: string;
  observedAt: string; counterparty: Counterparty; arrivedVia: string | null;
}>> {
  return ((await query(
    `SELECT b.kind, k.what_it_is, b.amount_cents, b.currency, b.observed_at, b.counterparty, b.arrived_via
       FROM business_outcome_events b JOIN business_outcome_event_kinds k ON k.kind = b.kind
      WHERE b.exposure_id = ? ORDER BY b.observed_at, b.rowid`, [exposureId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    kind: String(r.kind), whatItIs: String(r.what_it_is),
    amountCents: r.amount_cents == null ? null : Number(r.amount_cents), currency: String(r.currency),
    observedAt: String(r.observed_at), counterparty: String(r.counterparty) as Counterparty,
    arrivedVia: r.arrived_via == null ? null : String(r.arrived_via),
  }));
}

/** The identities the owner registered as his own, internal or test — never the identities themselves. */
export async function registeredCounterparties(founderId: string): Promise<Array<{
  id: string; provider: string; relation: string; registeredBy: string; registeredAt: string;
}>> {
  return ((await query(
    `SELECT id, provider, relation, registered_by, registered_at FROM internal_counterparties
      WHERE founder_id = ? AND retired_at IS NULL ORDER BY registered_at`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), provider: String(r.provider), relation: String(r.relation),
    registeredBy: String(r.registered_by), registeredAt: String(r.registered_at).slice(0, 10),
  }));
}
