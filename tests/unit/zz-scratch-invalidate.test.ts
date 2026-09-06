
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

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_world', 'owner@example.test', 'Owner']);
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [REF_OWNER, 'clerk_world_ref', 'ref@example.test', 'Rehearsal']);
});

describe('scratch: reviewer scenario', () => {
  it('unapproved, unexecuted act graded surprised by owner opinion invalidates a test the world was about to settle', async () => {
    const e = await exposed('real', { ...RULE, atMost: 1 });
    await event(e.exposureId, 'arrival');
    await event(e.exposureId, 'arrival');
    // The next tick would settle 'surprised'. Confirm without settling: peek via a dry check is not available, so proceed.
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
      VALUES ('wb_software_s', NULL, 'change_software', 'ask me before changing software', 'ask_first')`);
    const actId = 'act_' + nanoid(6);
    await query(
      `INSERT INTO proposed_acts
         (id, product_id, subject, action_type, params_fingerprint, summary, why, expected_effect,
          risk, consequence, proposed_by, expires_at, experiment_id, measurement_critical)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','+1 day'),?,?)`,
      [actId, e.productId, 'change_software', 'workshop_change', 'fp_' + actId, 'wire the checkout',
        'so people can pay', 'a working checkout', 'low', 'low', 'institution:tick', e.experimentId, 1]);
    const act = (await query('SELECT decision, consumed_at FROM proposed_acts WHERE id = ?', [actId])).rows[0] as Record<string, unknown>;
    expect(act.decision).toBeNull();
    expect(act.consumed_at).toBeNull();
    const graded = await resolvePrediction({ founderId: OWNER, kind: 'proposed_act', predictionId: actId,
      resolvedBy: 'owner', evidenceRef: 'opinion', verdict: 'surprised', because: 'it looked broken',
      predictedAt: new Date(Date.now() - 60_000).toISOString() });
    expect('id' in graded).toBe(true);
    const inv = await invalidateExperiment({ experimentId: e.experimentId, because: 'checkout_broken',
      by: 'institution:tick', actId });
    console.log('INVALIDATE ->', JSON.stringify(inv));
    const row = (await query(`SELECT validity, invalidated_by, verdict FROM venture_experiments WHERE id = ?`, [e.experimentId])).rows[0];
    console.log('ROW ->', JSON.stringify(row));
    const s = await settleFromTheWorld(e.experimentId, new Date(Date.now() - 60_000));
    console.log('SETTLE ->', JSON.stringify(s));
    const rr = await rerunExperiment({ experimentId: e.experimentId });
    console.log('RERUN ->', JSON.stringify(rr));
    expect('invalidated' in inv).toBe(true);
  });

  it('control: same state, no act — the tick settles surprised and the owner can no longer invalidate', async () => {
    const e = await exposed('real', { ...RULE, atMost: 1 });
    await event(e.exposureId, 'arrival');
    await event(e.exposureId, 'arrival');
    const s = await settleFromTheWorld(e.experimentId, new Date(Date.now() - 60_000));
    console.log('CONTROL SETTLE ->', JSON.stringify(s));
    expect(s.settled).toBe('surprised');
  });
});
