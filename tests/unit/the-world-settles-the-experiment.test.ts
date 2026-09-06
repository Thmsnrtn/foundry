// =============================================================================
// THE WORLD SETTLES THE EXPERIMENT.
//
// Before this, a sealed prediction could be settled by exactly one thing: the
// owner typing in what happened. This file proves the return leg from the
// world — an offer placed, a provider's events landing against it, the sealed
// rule applied by code with no opinion — and proves the distinctions the
// owner insisted on:
//
//   - internal activity never counts: his own payment, a collaborator's, a
//     test account's, or one the provider could not classify;
//   - 'unmatched_external' is what it says, and the sentence built on it
//     never says "stranger";
//   - measurement failure is not market failure: only a measurement-critical
//     act resolved 'surprised' invalidates, an incidental surprise beside a
//     disappointing result changes nothing, and an invalid test has no verdict;
//   - a re-run after a valid contradiction needs the claim revised; a re-run
//     of an invalid test needs nothing;
//   - earned means reality recognised it, and the grace before a failed test
//     retires its asset is policy the owner can supersede;
//   - the reference world rehearses all of it and grades nothing.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.test';

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { resolvePrediction } from '../../src/services/institution/calibration.js';
import { formClaim, observe, reviseClaim } from '../../src/services/venture/market-evidence.js';
import { decideExperiment, designExperiment } from '../../src/services/venture/validation.js';
import {
  bindActToExperiment, counterpartyHmac, firstClosureOf, invalidateExperiment, placeExposure,
  recordBusinessOutcome, registerInternalCounterparty, rerunExperiment, retireWhatFailed,
  settleFromTheWorld, whatTheWorldOwes,
} from '../../src/services/venture/outcome.js';

const OWNER = 'world_owner';
// One live search per person; the reference world rehearses as somebody else.
const REF_OWNER = 'world_ref_owner';
const ownerOf = (world: 'real' | 'reference'): string => world === 'reference' ? REF_OWNER : OWNER;
const RULE = { event: 'payment', atLeast: 1, outOf: 'arrival', atMost: 30, withinDays: 14 };

const mandates = new Map<string, string>();
async function candidate(world: 'real' | 'reference'): Promise<{ opportunityId: string; unknownId: string; claimId: string }> {
  let mandate = mandates.get(world);
  if (mandate === undefined) {
    mandate = 'm_' + nanoid(6);
    await query(`INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode) VALUES (?,?,?,?)`,
      [mandate, ownerOf(world), 'Make the river stronger', world]);
    mandates.set(world, mandate);
  }
  const opportunityId = 'o_' + nanoid(6);
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis,
        sources_json, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, mandate, ownerOf(world), 'a day-rate page', 'freelancers', 'they undercharge',
      'people ask each other', 'misread if nobody pays', '["https://forum.example/1"]', world]);
  const unknownId = 'u_' + nanoid(6);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking) VALUES (?,?,?,?,1)`,
    [unknownId, ownerOf(world), opportunityId, 'whether anybody pays']);
  const claimId = await formClaim({ founderId: ownerOf(world), evidenceMode: world, opportunityId,
    claim: 'a freelancer would pay a few dollars for a day-rate figure' });
  return { opportunityId, unknownId, claimId };
}

async function approvedExperiment(world: 'real' | 'reference', rule = RULE): Promise<{
  experimentId: string; productId: string; claimId: string; unknownId: string; opportunityId: string;
}> {
  const c = await candidate(world);
  const experimentId = await designExperiment({
    founderId: ownerOf(world), opportunityId: c.opportunityId, unknownId: c.unknownId, claimId: c.claimId,
    whatWeDo: 'put a page with a price in front of people', whatWeExpect: 'at least one pays',
    wouldDisprove: 'thirty arrive and nobody pays', costCents: 1500, evidenceMode: world,
    settlesWhen: rule });
  await decideExperiment({ experimentId, decision: 'approved', by: `founder:${ownerOf(world)}` });
  // The world takes longer than a second to answer; a resolution is refused in
  // the same second as the prediction it grades, and that refusal is right.
  await query(`UPDATE venture_experiments SET decided_at = datetime('now','-1 minute') WHERE id = ?`, [experimentId]);
  const p = (await query('SELECT id FROM products WHERE from_experiment_id = ?', [experimentId]))
    .rows[0] as Record<string, unknown>;
  return { experimentId, productId: String(p.id), claimId: c.claimId, unknownId: c.unknownId,
    opportunityId: c.opportunityId };
}

async function exposed(world: 'real' | 'reference', rule = RULE) {
  const e = await approvedExperiment(world, rule);
  const x = await placeExposure({ experimentId: e.experimentId, productId: e.productId,
    provider: 'stripe', exposureRef: 'plink_' + nanoid(6), evidenceMode: world, placedBy: `act:${nanoid(4)}` });
  if ('refused' in x) throw new Error(x.refused);
  return { ...e, exposureId: x.id };
}

/** Close the window by backdating the offer, and settle a minute ago so a
 * revision made now is strictly after the result. */
async function settleClosed(e: { experimentId: string; exposureId: string }) {
  await query(`UPDATE experiment_exposures SET placed_at = datetime('now','-20 days') WHERE id = ?`, [e.exposureId]);
  return settleFromTheWorld(e.experimentId, new Date(Date.now() - 60_000));
}

let seq = 0;
async function event(exposureId: string, kind: string, opts: {
  payer?: string | null; amount?: number; at?: Date;
} = {}) {
  seq += 1;
  const r = await recordBusinessOutcome({
    exposureId, kind, amountCents: opts.amount ?? (kind === 'payment' ? 500 : null),
    observedAt: opts.at ?? new Date(), provider: 'stripe', providerRef: `evt_${String(seq)}`,
    payerReference: opts.payer === undefined ? null : opts.payer });
  if ('refused' in r) throw new Error(r.refused);
  return r;
}

let askedFirst = false;
async function anAct(productId: string, experimentId: string, critical: boolean): Promise<string> {
  // A proposal exists only against a standing "ask me first"; the owner asked
  // once to be consulted about changes to software, and every act here is one.
  if (!askedFirst) {
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
      VALUES ('wb_software', NULL, 'change_software', 'ask me before changing software', 'ask_first')`);
    askedFirst = true;
  }
  const id = 'act_' + nanoid(6);
  await query(
    `INSERT INTO proposed_acts
       (id, product_id, subject, action_type, params_fingerprint, summary, why, expected_effect,
        risk, consequence, proposed_by, expires_at, experiment_id, measurement_critical)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','+1 day'),?,?)`,
    [id, productId, 'change_software', 'workshop_change', 'fp_' + id, 'wire the checkout',
      'so people can pay', 'a working checkout', 'low', 'low', 'hand:test', experimentId, critical ? 1 : 0]);
  await query(
    `UPDATE proposed_acts SET decision = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    [`founder:${OWNER}`, id]);
  return id;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_world', 'owner@example.test', 'Owner']);
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [REF_OWNER, 'clerk_world_ref', 'ref@example.test', 'Rehearsal']);
});

describe('the rule and the exposure', () => {
  it('the settlement rule is sealed with the prediction, and an exposure needs an approved test in the same world', async () => {
    const e = await approvedExperiment('real');
    await expect(query(`UPDATE venture_experiments SET settles_when = ? WHERE id = ?`,
      ['{"event":"payment","at_least":99,"within_days":1}', e.experimentId]))
      .rejects.toThrow(/settlement_rule_is_sealed/);

    const c = await candidate('real');
    const undecided = await designExperiment({ founderId: OWNER, opportunityId: c.opportunityId,
      unknownId: c.unknownId, whatWeDo: 'x', whatWeExpect: 'y', wouldDisprove: 'z', evidenceMode: 'real' });
    const early = await placeExposure({ experimentId: undecided, provider: 'stripe', exposureRef: 'p1',
      evidenceMode: 'real', placedBy: 'act:1' });
    expect('refused' in early && early.refused).toMatch(/experiment_not_approved/);

    const wrongWorld = await placeExposure({ experimentId: e.experimentId, productId: e.productId,
      provider: 'stripe', exposureRef: 'p2', evidenceMode: 'reference', placedBy: 'act:1' });
    expect('refused' in wrongWorld && wrongWorld.refused).toMatch(/world_mismatch/);

    const ok = await placeExposure({ experimentId: e.experimentId, productId: e.productId,
      provider: 'stripe', exposureRef: 'p3', evidenceMode: 'real', placedBy: 'act:1' });
    expect('id' in ok).toBe(true);
    const second = await placeExposure({ experimentId: e.experimentId, productId: e.productId,
      provider: 'gumroad', exposureRef: 'p4', evidenceMode: 'real', placedBy: 'act:1' });
    expect('refused' in second).toBe(true);
    expect(await whatTheWorldOwes()).toContain(e.experimentId);
  });
});

describe('who was on the other side', () => {
  it('classifies by control path, stores no identity, and the ledger is append-only', async () => {
    const e = await exposed('real');
    const reg = await registerInternalCounterparty({ founderId: OWNER, provider: 'stripe',
      reference: 'cus_owner_himself', relation: 'owner', by: `founder:${OWNER}` });
    expect('id' in reg).toBe(true);
    const notAPerson = await registerInternalCounterparty({ founderId: OWNER, provider: 'stripe',
      reference: 'cus_x', relation: 'internal', by: 'institution:tick' });
    expect('refused' in notAPerson && notAPerson.refused).toMatch(/owner_only/);

    const his = await event(e.exposureId, 'payment', { payer: 'cus_owner_himself' });
    expect(his.counterparty).toBe('owner');
    const someone = await event(e.exposureId, 'payment', { payer: 'cus_never_seen' });
    expect(someone.counterparty).toBe('unmatched_external');
    const nobody = await event(e.exposureId, 'payment', { payer: null });
    expect(nobody.counterparty).toBe('unknown');

    // Nothing stored knows the payer. Not the reference, not its hash.
    const stored = (await query('SELECT * FROM business_outcome_events WHERE exposure_id = ?', [e.exposureId]))
      .rows.map((r) => JSON.stringify(r)).join('\n');
    expect(stored).not.toContain('cus_never_seen');
    expect(stored).not.toContain(counterpartyHmac('stripe', 'cus_never_seen'));

    // Idempotent on the provider's reference.
    const again = await recordBusinessOutcome({ exposureId: e.exposureId, kind: 'arrival',
      observedAt: new Date(), provider: 'stripe', providerRef: `evt_${String(seq)}` });
    expect('duplicate' in again && again.duplicate).toBe(true);

    await expect(query(`UPDATE business_outcome_events SET counterparty = 'unmatched_external' WHERE id = ?`, [his.id]))
      .rejects.toThrow(/immutable/);
    // Deletion is not refused at the row: append-only means history is never
    // rewritten, not that a person's data outlives their right to have it
    // removed. The erasure path is the one thing that deletes here.
    const future = await recordBusinessOutcome({ exposureId: e.exposureId, kind: 'arrival',
      observedAt: new Date(Date.now() + 3_600_000), provider: 'stripe', providerRef: 'evt_future' });
    expect('refused' in future && future.refused).toMatch(/observed_in_the_future/);
    const noAmount = await recordBusinessOutcome({ exposureId: e.exposureId, kind: 'payment',
      observedAt: new Date(), provider: 'stripe', providerRef: 'evt_noamount' });
    expect('refused' in noAmount && noAmount.refused).toMatch(/payment_needs_an_amount/);
  });
});

describe('settlement by the world', () => {
  it('internal and unclassifiable payments never count; an unmatched one that was delivered settles, grades, and earns', async () => {
    const e = await exposed('real');
    await registerInternalCounterparty({ founderId: OWNER, provider: 'stripe', reference: 'cus_me',
      relation: 'owner', by: `founder:${OWNER}` });
    await event(e.exposureId, 'arrival');
    await event(e.exposureId, 'payment', { payer: 'cus_me' });
    await event(e.exposureId, 'payment', { payer: null });
    let s = await settleFromTheWorld(e.experimentId);
    expect(s.settled).toBeNull();
    expect(s.counted.event).toBe(0);
    expect(s.counted.uncounted).toBe(2);
    let closure = await firstClosureOf(OWNER);
    expect(closure.reached).toBe(false);

    await event(e.exposureId, 'payment', { payer: 'cus_someone_else' });
    await event(e.exposureId, 'delivery');
    s = await settleFromTheWorld(e.experimentId);
    expect(s.settled).toBe('as_predicted');
    expect(s.earned).toBe(true);
    expect(s.because).toContain('2 payments did not count');

    const row = (await query(
      `SELECT e.verdict, e.ran_at, u.answered_at, p.standing, p.earned_by, m.became_product
         FROM venture_experiments e
         JOIN market_unknowns u ON u.id = e.unknown_id
         JOIN products p ON p.from_experiment_id = e.id
         JOIN venture_opportunities o ON o.id = e.opportunity_id
         JOIN venture_mandates m ON m.id = o.mandate_id
        WHERE e.id = ?`, [e.experimentId])).rows[0] as Record<string, unknown>;
    expect(row.verdict).toBe('as_predicted');
    expect(row.answered_at).not.toBeNull();
    expect(row.standing).toBe('earned');
    expect(String(row.earned_by)).toBe(`business_outcome:${e.exposureId}`);
    expect(row.became_product).toBe(e.productId);
    const graded = (await query(
      `SELECT resolved_by, verdict FROM prediction_resolutions WHERE kind = 'venture_experiment' AND prediction_id = ?`,
      [e.experimentId])).rows[0] as Record<string, unknown>;
    expect(graded.resolved_by).toBe('business_outcome');
    expect(graded.verdict).toBe('as_predicted');
    const supports = (await query(
      `SELECT bearing, source_type FROM market_observations WHERE claim_id = ? AND source LIKE 'experiment_exposure:%'`,
      [e.claimId])).rows[0] as Record<string, unknown>;
    expect(supports.bearing).toBe('supports');
    expect(supports.source_type).toBe('provider_api');

    closure = await firstClosureOf(OWNER);
    expect(closure.reached).toBe(true);
    expect(closure.sentence).toContain('unmatched external counterparty, not a proven stranger');
    expect(closure.sentence.toLowerCase()).not.toMatch(/a stranger paid/);
    expect(await settleFromTheWorld(e.experimentId)).toMatchObject({ settled: null, because: 'already settled' });
    expect(await whatTheWorldOwes()).not.toContain(e.experimentId);
  });

  it('too many arrivals and no payment disproves it early; a closed window with nothing is surprised; some is partly', async () => {
    const early = await exposed('real', { ...RULE, atMost: 2 });
    for (let i = 0; i < 3; i += 1) await event(early.exposureId, 'arrival');
    const s1 = await settleFromTheWorld(early.experimentId);
    expect(s1.settled).toBe('surprised');
    expect(s1.earned).toBe(false);
    const st = (await query('SELECT standing FROM products WHERE id = ?', [early.productId])).rows[0] as Record<string, unknown>;
    expect(st.standing).toBe('experimental');
    const contradicts = (await query(
      `SELECT bearing FROM market_observations WHERE claim_id = ? AND source LIKE 'experiment_exposure:%'`,
      [early.claimId])).rows[0] as Record<string, unknown>;
    expect(contradicts.bearing).toBe('contradicts');

    const quiet = await exposed('real');
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await settleFromTheWorld(quiet.experimentId)).settled).toBeNull();
    expect((await settleFromTheWorld(quiet.experimentId, later)).settled).toBe('surprised');

    const some = await exposed('real', { ...RULE, atLeast: 3 });
    await event(some.exposureId, 'payment', { payer: 'cus_a' });
    await event(some.exposureId, 'delivery');
    expect((await settleFromTheWorld(some.experimentId)).settled).toBeNull();
    const s3 = await settleFromTheWorld(some.experimentId, later);
    expect(s3.settled).toBe('partly');
    expect(s3.earned).toBe(true);
    const g = (await query(
      `SELECT verdict FROM prediction_resolutions WHERE kind = 'venture_experiment' AND prediction_id = ?`,
      [some.experimentId])).rows[0] as Record<string, unknown>;
    expect(g.verdict).toBe('partly');
  });
});

describe('measurement failure is not market failure', () => {
  it('only a measurement-critical act that failed invalidates; an invalid test has no verdict and re-runs freely', async () => {
    const e = await exposed('real');
    const checkout = await anAct(e.productId, e.experimentId, true);
    const banner = await anAct(e.productId, e.experimentId, false);
    // Sealed once decided: the experiment was approved before the acts existed.
    const flip = await bindActToExperiment({ actId: checkout, experimentId: e.experimentId, measurementCritical: false });
    expect('refused' in flip && flip.refused).toMatch(/experiment_binding_is_sealed/);

    const notYet = await invalidateExperiment({ experimentId: e.experimentId, because: 'checkout_broken',
      by: 'hand:test', actId: checkout });
    expect('refused' in notYet && notYet.refused).toMatch(/did not fail/);
    await resolvePrediction({ founderId: OWNER, kind: 'proposed_act', predictionId: checkout,
      resolvedBy: 'later_observation', evidenceRef: 'log:1', verdict: 'surprised',
      because: 'the checkout returned 500 on every attempt', predictedAt: new Date(Date.now() - 60_000).toISOString() });
    await resolvePrediction({ founderId: OWNER, kind: 'proposed_act', predictionId: banner,
      resolvedBy: 'later_observation', evidenceRef: 'log:2', verdict: 'surprised',
      because: 'the banner rendered in the wrong colour', predictedAt: new Date(Date.now() - 60_000).toISOString() });
    const incidental = await invalidateExperiment({ experimentId: e.experimentId, because: 'instrumentation_defect',
      by: 'hand:test', actId: banner });
    expect('refused' in incidental && incidental.refused).toMatch(/not measurement-critical/);
    const notOwner = await invalidateExperiment({ experimentId: e.experimentId, because: 'checkout_broken', by: 'hand:test' });
    expect('refused' in notOwner).toBe(true);

    const done = await invalidateExperiment({ experimentId: e.experimentId, because: 'checkout_broken',
      by: 'hand:test', actId: checkout });
    expect('invalidated' in done).toBe(true);
    const row = (await query(
      `SELECT validity, invalid_because, invalidated_by, verdict, ran_at,
              (SELECT withdrawn_at FROM experiment_exposures WHERE id = ?) AS withdrawn
         FROM venture_experiments WHERE id = ?`, [e.exposureId, e.experimentId])).rows[0] as Record<string, unknown>;
    expect(row.validity).toBe('invalid');
    expect(row.invalid_because).toBe('checkout_broken');
    expect(row.invalidated_by).toBe(`act:${checkout}`);
    expect(row.verdict).toBeNull();
    expect(row.withdrawn).not.toBeNull();
    expect((await settleFromTheWorld(e.experimentId)).because).toMatch(/invalid/);
    await expect(query(`UPDATE venture_experiments SET validity = 'valid', invalid_because = NULL, invalidated_by = NULL, invalidated_at = NULL WHERE id = ?`, [e.experimentId]))
      .rejects.toThrow(/invalid_is_final/);
    await expect(query(`UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'x', verdict = 'surprised' WHERE id = ?`, [e.experimentId]))
      .rejects.toThrow(/invalid_test_has_no_verdict/);
    const graded = (await query(
      `SELECT COUNT(*) AS n FROM prediction_resolutions WHERE kind = 'venture_experiment' AND prediction_id = ?`,
      [e.experimentId])).rows[0] as Record<string, unknown>;
    expect(Number(graded.n)).toBe(0);

    // Re-run without touching the claim: the world was never asked.
    const rerun = await rerunExperiment({ experimentId: e.experimentId });
    if ('refused' in rerun) throw new Error(rerun.refused);
    const r = (await query('SELECT rerun_of, decision, settles_when FROM venture_experiments WHERE id = ?', [rerun.id]))
      .rows[0] as Record<string, unknown>;
    expect(r.rerun_of).toBe(e.experimentId);
    expect(r.decision).toBeNull();
    expect(String(r.settles_when)).toContain('"payment"');
    await expect(query(`UPDATE venture_experiments SET rerun_of = NULL WHERE id = ?`, [rerun.id]))
      .rejects.toThrow(/rerun_of_is_immutable/);
  });

  it('a disappointing result beside an incidental surprise stays valid, settles surprised, and re-runs only on a revised claim', async () => {
    const e = await exposed('real', { ...RULE, atMost: 1 });
    const banner = await anAct(e.productId, e.experimentId, false);
    await resolvePrediction({ founderId: OWNER, kind: 'proposed_act', predictionId: banner,
      resolvedBy: 'later_observation', evidenceRef: 'log:3', verdict: 'surprised',
      because: 'the page took four seconds to load', predictedAt: new Date(Date.now() - 60_000).toISOString() });
    await event(e.exposureId, 'arrival');
    await event(e.exposureId, 'arrival');
    const s = await settleFromTheWorld(e.experimentId, new Date(Date.now() - 60_000));
    expect(s.settled).toBe('surprised');
    const escape = await invalidateExperiment({ experimentId: e.experimentId, because: 'instrumentation_defect',
      by: 'hand:test', actId: banner });
    expect('refused' in escape && escape.refused).toMatch(/not measurement-critical/);
    // Nor can the owner, now the world has answered.
    const owner = await invalidateExperiment({ experimentId: e.experimentId, because: 'instrumentation_defect',
      by: `founder:${OWNER}` });
    expect('refused' in owner && owner.refused).toMatch(/approved_unsettled/);

    const same = await rerunExperiment({ experimentId: e.experimentId });
    expect('refused' in same && same.refused).toMatch(/rerun_needs_a_revised_claim/);
    // The contradiction is on the record, so the claim can narrow; then it may run again.
    const revised = await reviseClaim({ founderId: OWNER, claimId: e.claimId,
      into: 'a freelancer quoting a first retainer would pay for a day-rate figure',
      because: 'the arrivals were students', opportunityId: e.opportunityId });
    if ('refused' in revised) throw new Error(revised.refused);
    const again = await rerunExperiment({ experimentId: e.experimentId });
    expect('id' in again).toBe(true);
  });
});

describe('what a failed test does to its asset', () => {
  it('retires it after the grace the policy gives, unless a re-run is pending, and the grace is the owner\'s to change', async () => {
    const e = await exposed('real');
    expect((await settleClosed(e)).settled).toBe('surprised');
    const tenDaysOn = new Date(Date.now() + 10 * 86_400_000);
    // Too soon under the default thirty days.
    expect(await retireWhatFailed(tenDaysOn)).not.toContain(e.productId);
    // The owner shortens it to seven.
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    const changed = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'failed_test_grace_days',
      treatment: 'policy', value: '7', why: 'a week is long enough to decide', by: `founder:${OWNER}` });
    expect('id' in changed).toBe(true);
    const retired = await retireWhatFailed(tenDaysOn);
    expect(retired).toContain(e.productId);
    const p = (await query('SELECT status, retired_because FROM products WHERE id = ?', [e.productId]))
      .rows[0] as Record<string, unknown>;
    expect(p.status).toBe('archived');
    expect(String(p.retired_because)).toContain('7 days');

    // A pending re-run holds the asset.
    const held = await exposed('real');
    expect((await settleClosed(held)).settled).toBe('surprised');
    const revised = await reviseClaim({ founderId: OWNER, claimId: held.claimId, into: 'narrower',
      because: 'x', opportunityId: held.opportunityId });
    if ('refused' in revised) throw new Error(revised.refused);
    const rerun = await rerunExperiment({ experimentId: held.experimentId });
    if ('refused' in rerun) throw new Error(rerun.refused);
    expect(await retireWhatFailed(new Date(Date.now() + 40 * 86_400_000))).not.toContain(held.productId);
  });
});

describe('the reference world', () => {
  it('rehearses the whole leg with a forced counterparty and grades nothing', async () => {
    const e = await exposed('reference');
    const arrival = await event(e.exposureId, 'arrival', { payer: 'anything' });
    expect(arrival.counterparty).toBe('reference');
    await event(e.exposureId, 'payment', { payer: 'cus_ref' });
    await event(e.exposureId, 'delivery');
    const s = await settleFromTheWorld(e.experimentId);
    expect(s.settled).toBe('as_predicted');
    expect(s.earned).toBe(false);
    const graded = (await query(
      `SELECT COUNT(*) AS n FROM prediction_resolutions WHERE kind = 'venture_experiment' AND prediction_id = ?`,
      [e.experimentId])).rows[0] as Record<string, unknown>;
    expect(Number(graded.n)).toBe(0);
    const obs = (await query(
      `SELECT source_type, evidence_mode FROM market_observations WHERE claim_id = ? AND source LIKE 'experiment_exposure:%'`,
      [e.claimId])).rows[0] as Record<string, unknown>;
    expect(obs.source_type).toBe('reference_world');
    expect(obs.evidence_mode).toBe('reference');
    // And the milestone reads the real world only.
    const closure = await firstClosureOf(OWNER);
    expect(closure.experimentId).not.toBe(e.experimentId);
    await expect(observe({ founderId: REF_OWNER, claimId: e.claimId, sourceType: 'provider_api', source: 'x',
      saw: 'y', bearing: 'supports', directness: 'direct', observedAt: new Date(), evidenceMode: 'real' }))
      .rejects.toThrow();
  });
});
