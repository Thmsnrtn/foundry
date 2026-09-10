// =============================================================================
// THE HAND CANNOT WRITE TO ANYONE THE OWNER DID NOT APPROVE — AND THE ROWS
// SAY SO, NOT THE HAND.
//
// Migration 284 puts the first real experiment's authority in the schema:
// nobody is born approved, only the owner reviews, an outbound action bound
// to an experiment is admitted only under an act he approved for exactly that
// experiment, to somebody he approved or to somebody who is owed. Each RAISE
// is planted here as the defect it refuses, so the proof is of the trigger
// and not of the code that happens to call it politely today.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '1'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.test';

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { formClaim } from '../../src/services/venture/market-evidence.js';
import { decideExperiment, designExperiment } from '../../src/services/venture/validation.js';
import { bindActToExperiment, placeExposure, recordBusinessOutcome } from '../../src/services/venture/outcome.js';
import { decideProposedAct, proposeAct, setBoundary } from '../../src/services/institution/standing-intent.js';
import { stateOfferShape } from '../../src/services/venture/asset.js';
import { answerLighter } from '../../src/services/venture/legal-surface.js';

const OWNER = 'g_owner'; const OTHER = 'g_other';
let X = ''; let ASSET = ''; let ACT = ''; let EXPOSURE = ''; let OPP = '';
const insertAction = (over: Record<string, unknown>) => {
  const base: Record<string, unknown> = {
    id: nanoid(), product_id: ASSET, agent_name: 'institution:hand', integration_name: 'resend', action_type: 'send_email', authority_level: 0,
    status: 'pending_approval', parameters_json: JSON.stringify({ to: ['shop@example.com'], subject: 's', html: 'h' }), preview_text: 'p', rationale: 'r',
    confidence: 1, expires_at: '2030-01-01', effect_id: `fx_${nanoid(6)}`, outcome_status: 'unresolved', experiment_id: X, experiment_act: 'offer',
    recipient_id: null, fulfilment_id: null, proposed_act_id: ACT, ...over,
  };
  const cols = Object.keys(base);
  return query(`INSERT INTO outbound_actions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((k) => base[k]));
};

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?),(?,?,?,?)`, [OWNER, 'g_c1', 'owner@example.test', 'Owner', OTHER, 'g_c2', 'other@example.test', 'Other']);
  await query(`INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode) VALUES ('g_m', ?, 'find a thing', 'real')`, [OWNER]);
  OPP = 'g_o';
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?, 'g_m', ?, 'a brief', 'shops', 'they miss bids', 'they pay for listings', 'nobody pays', '["https://x.example"]', 'real')`, [OPP, OWNER]);
  const claim = await formClaim({ founderId: OWNER, evidenceMode: 'real', opportunityId: OPP, claim: 'a shop pays $29' });
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking) VALUES ('g_u', ?, ?, 'will they pay?', 1)`, [OWNER, OPP]);
  X = await designExperiment({ founderId: OWNER, opportunityId: OPP, unknownId: 'g_u', claimId: claim, evidenceMode: 'real', costCents: 1000,
    whatWeDo: 'offer it', whatWeExpect: 'one pays and receives', wouldDisprove: 'none does', settlesWhen: { event: 'delivery', atLeast: 1, outOf: 'offer_delivered', atMost: 5, withinDays: 7 } });
  await query('UPDATE venture_experiments SET needs_workshop = 0 WHERE id = ?', [X]);
});

describe('whom Foundry may write to', () => {
  it('a recipient is never born approved, needs a counterparty and a real address, and belongs to a live experiment of the same owner', async () => {
    const ins = (over: Record<string, unknown>) => {
      const base: Record<string, unknown> = { id: nanoid(), founder_id: OWNER, experiment_id: X, counterparty_ref: 'A Shop', email: 'a@shop.example', channel: 'email', ...over };
      const cols = Object.keys(base);
      return query(`INSERT INTO experiment_recipients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((k) => base[k]));
    };
    await expect(ins({ review_status: 'approved' })).rejects.toThrow(/review_not_owner_act/);
    await expect(ins({ reviewed_by: `founder:${OWNER}` })).rejects.toThrow(/review_not_owner_act/);
    await expect(ins({ counterparty_ref: '  ' })).rejects.toThrow(/counterparty_required/);
    await expect(ins({ email: 'not an address' })).rejects.toThrow(/email_invalid/);
    await expect(ins({ email: null })).rejects.toThrow(/email_invalid/);
    await expect(ins({ founder_id: OTHER })).rejects.toThrow(/experiment_invalid/);
    await expect(ins({ experiment_id: 'nope' })).rejects.toThrow(/experiment_invalid/);
    await expect(ins({ channel: 'web_form', email: null, id: 'g_r_web', counterparty_ref: 'Web Shop' })).resolves.toBeDefined();
    await expect(ins({ id: 'g_r1' })).resolves.toBeDefined();
  });

  it('only the owner reviews, every review is stamped, a strike has a reason, and the row is otherwise immutable', async () => {
    const upd = (set: string, args: unknown[] = []) => query(`UPDATE experiment_recipients SET ${set} WHERE id = 'g_r1'`, args);
    await expect(upd(`review_status = 'approved', reviewed_at = datetime('now')`)).rejects.toThrow(/reviewer_invalid/);
    await expect(upd(`review_status = 'approved', reviewed_by = 'founder:${OTHER}', reviewed_at = datetime('now')`)).rejects.toThrow(/reviewer_invalid/);
    await expect(upd(`review_status = 'approved', reviewed_by = 'institution:hand', reviewed_at = datetime('now')`)).rejects.toThrow(/reviewer_invalid/);
    await expect(upd(`review_status = 'approved', reviewed_by = 'founder:${OWNER}'`)).rejects.toThrow(/review_stamp_required/);
    await expect(upd(`review_status = 'struck', reviewed_by = 'founder:${OWNER}', reviewed_at = datetime('now')`)).rejects.toThrow(/strike_reason_required/);
    await expect(upd(`email = 'b@shop.example'`)).rejects.toThrow(/reviewer_invalid/);
    await expect(upd(`counterparty_ref = 'B Shop'`)).rejects.toThrow(/immutable/);
    await expect(upd(`experiment_id = 'other'`)).rejects.toThrow(/immutable/);
    await expect(upd(`channel = 'web_form'`)).rejects.toThrow(/immutable/);
    await expect(upd(`review_status = 'approved', reviewed_by = 'founder:${OWNER}', reviewed_at = datetime('now')`)).resolves.toBeDefined();
    // A web-form business becomes reachable only with an address, and only by him.
    await expect(query(`UPDATE experiment_recipients SET channel = 'email', email = 'w@shop.example', review_status = 'approved', reviewed_by = 'founder:${OWNER}', reviewed_at = datetime('now') WHERE id = 'g_r_web'`)).resolves.toBeDefined();
    await expect(query(`UPDATE experiment_recipients SET channel = 'email' WHERE id = 'g_r_web'`)).resolves.toBeDefined(); // no change
  });
});

describe('what it sends and what it delivers', () => {
  it('a material is complete, an offer carries an https link, one live per kind, and nothing about it changes afterwards', async () => {
    const ins = (over: Record<string, unknown>) => {
      const base: Record<string, unknown> = { id: nanoid(), founder_id: OWNER, experiment_id: X, kind: 'deliverable', title: 'The brief', body: 'text', digest: 'abcd', recorded_by: 'test', ...over };
      const cols = Object.keys(base);
      return query(`INSERT INTO experiment_materials (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((k) => base[k]));
    };
    await expect(ins({ title: ' ' })).rejects.toThrow(/incomplete/);
    await expect(ins({ body: '' })).rejects.toThrow(/incomplete/);
    await expect(ins({ recorded_by: '' })).rejects.toThrow(/incomplete/);
    await expect(ins({ kind: 'offer' })).rejects.toThrow(/offer_needs_a_link/);
    await expect(ins({ kind: 'offer', payment_link_url: 'http://insecure.example' })).rejects.toThrow(/offer_needs_a_link/);
    await expect(ins({ founder_id: OTHER })).rejects.toThrow(/experiment_invalid/);
    await expect(ins({ superseded_at: '2026-01-01' })).rejects.toThrow(/cannot_arrive_superseded/);
    await expect(ins({ id: 'g_mat1' })).resolves.toBeDefined();
    await expect(ins({})).rejects.toThrow(/UNIQUE|unique/);
    await expect(query(`UPDATE experiment_materials SET body = 'changed' WHERE id = 'g_mat1'`)).rejects.toThrow(/immutable/);
    await expect(query(`UPDATE experiment_materials SET digest = 'x' WHERE id = 'g_mat1'`)).rejects.toThrow(/immutable/);
    await expect(query(`UPDATE experiment_materials SET superseded_at = datetime('now') WHERE id = 'g_mat1'`)).resolves.toBeDefined();
    await expect(query(`UPDATE experiment_materials SET superseded_at = NULL WHERE id = 'g_mat1'`)).rejects.toThrow(/immutable/);
  });
});

describe('the binding of an outbound action to the experiment', () => {
  beforeAll(async () => {
    // Through the surface that owns this decision: the test names real
    // businesses, so the general control refuses it by design.
    await decideExperiment({ experimentId: X, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
    ASSET = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
    await setBoundary({ productId: ASSET, subject: 'contact_people', mode: 'ask_first', statement: 'ask me' });
    ACT = await proposeAct({ productId: ASSET, subject: 'contact_people', actionType: 'send_email', params: { campaign: X }, summary: 'write to them', why: 'w', expectedEffect: 'e', risk: 'r', consequence: 'low', rung: 'public', costCents: 0, proposedBy: 'institution:hand' });
    await bindActToExperiment({ actId: ACT, experimentId: X, measurementCritical: true });
  });

  it('is born unapproved, bound to an act, on the experiment\'s own asset, with the test live', async () => {
    // Not yet approved: the act alone authorises nothing.
    await expect(insertAction({ recipient_id: 'g_r1', parameters_json: JSON.stringify({ to: ['a@shop.example'] }) })).rejects.toThrow(/not_authorised/);
    await decideProposedAct({ id: ACT, decision: 'approved', decidedBy: `founder:${OWNER}` });
    await expect(insertAction({ status: 'approved', recipient_id: 'g_r1' })).rejects.toThrow(/born_approved/);
    await expect(insertAction({ approved_by: 'x', recipient_id: 'g_r1' })).rejects.toThrow(/born_approved/);
    await expect(insertAction({ experiment_act: null })).rejects.toThrow(/binding_invalid/);
    await expect(insertAction({ proposed_act_id: null })).rejects.toThrow(/binding_invalid/);
    await expect(insertAction({ effect_id: null })).rejects.toThrow(/binding_invalid/);
    await expect(insertAction({ action_type: 'post_slack' })).rejects.toThrow(/binding_invalid/);
    await expect(insertAction({ integration_name: 'sendgrid' })).rejects.toThrow(/binding_invalid/);
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('g_other_asset', 'Elsewhere', ?)`, [OWNER]);
    await expect(insertAction({ product_id: 'g_other_asset', recipient_id: 'g_r1' })).rejects.toThrow(/asset_mismatch/);
  });

  it('an offer goes only to an approved email recipient whose address is the one in the message', async () => {
    await expect(insertAction({ recipient_id: null })).rejects.toThrow(/recipient_not_approved/);
    await expect(insertAction({ recipient_id: 'g_r1', parameters_json: JSON.stringify({ to: ['someone-else@example.com'] }) })).rejects.toThrow(/recipient_not_approved/);
    await query(`INSERT INTO experiment_recipients (id, founder_id, experiment_id, counterparty_ref, email, channel) VALUES ('g_r_pending', ?, ?, 'Pending Shop', 'p@shop.example', 'email')`, [OWNER, X]);
    await expect(insertAction({ recipient_id: 'g_r_pending', parameters_json: JSON.stringify({ to: ['p@shop.example'] }) })).rejects.toThrow(/recipient_not_approved/);
    // APPROVED IS NOT THE SAME AS COVERED BY THIS APPROVAL. Consent and evidence
    // were both read at the moment of sending, so consent over a group silently
    // extended to whoever in that group later qualified. An offer now needs the
    // act that named them, and being approved is not that.
    await expect(insertAction({ recipient_id: 'g_r1', parameters_json: JSON.stringify({ to: ['a@shop.example'] }) }))
      .rejects.toThrow(/recipient_not_in_this_authorisation/);
    await query(`UPDATE experiment_recipients SET authorised_act_id = ? WHERE id = 'g_r1'`, [ACT]);
    // And it cannot be moved to another act afterwards, or an old consent could
    // be pointed at a new campaign.
    await expect(query(`UPDATE experiment_recipients SET authorised_act_id = 'g_some_other_act' WHERE id = 'g_r1'`))
      .rejects.toThrow(/authority_stands/);
    // Nor given to somebody the owner never approved.
    await expect(query(`UPDATE experiment_recipients SET authorised_act_id = ? WHERE id = 'g_r_pending'`, [ACT]))
      .rejects.toThrow(/authority_needs_approval/);
    await expect(insertAction({ id: 'g_act_ok', recipient_id: 'g_r1', parameters_json: JSON.stringify({ to: ['a@shop.example'] }) })).resolves.toBeDefined();
    // The binding never changes; the door's own record of what happened may.
    await expect(query(`UPDATE outbound_actions SET recipient_id = 'g_r_pending' WHERE id = 'g_act_ok'`)).rejects.toThrow(/binding_immutable/);
    await expect(query(`UPDATE outbound_actions SET parameters_json = '{"to":["x@y.example"]}' WHERE id = 'g_act_ok'`)).rejects.toThrow(/binding_immutable/);
    await expect(query(`UPDATE outbound_actions SET status = 'executing' WHERE id = 'g_act_ok'`)).resolves.toBeDefined();
  });

  it('a delivery goes only to what is owed, and what is owed rests on a real payment at this experiment\'s exposure', async () => {
    await expect(insertAction({ experiment_act: 'delivery', fulfilment_id: null })).rejects.toThrow(/nothing_owed/);
    // An exposure, so a payment can be recorded against it.
    const shaped = await stateOfferShape({ productId: ASSET, by: `founder:${OWNER}`, shape: { sells: 'a brief', claimsMade: 'a shortlist', collects: 'nothing kept', deliversBy: 'email', sellsTo: 'MA shops', chargesHow: 'one-off' } });
    if ('refused' in shaped) throw new Error(shaped.refused);
    await answerLighter({ opportunityId: OPP, answer: 'one email' });
    for (const f of (await query(`SELECT fact, satisfied_when FROM structural_fact_kinds WHERE answers_requirement IS NOT NULL`, [])).rows as unknown as Array<Record<string, unknown>>) {
      await query(`INSERT INTO structural_facts (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds, recognised_by, evidence_mode) VALUES (?,?,?,?,?,?,?,?,?,'real')`,
        ['sf_' + nanoid(6), OWNER, 'company', ASSET, String(f.fact), Number(f.satisfied_when), 'offer_shape', 'as the pass would', 'test']);
    }
    const placed = await placeExposure({ experimentId: X, productId: ASSET, provider: 'stripe', exposureRef: 'plink_g', evidenceMode: 'real', placedBy: 'test' });
    if ('refused' in placed) throw new Error(placed.refused);
    EXPOSURE = placed.id;
    const paid = await recordBusinessOutcome({ exposureId: EXPOSURE, kind: 'payment', amountCents: 2900, currency: 'usd', observedAt: new Date(), provider: 'stripe', providerRef: 'pi_g_1', payerReference: 'buyer@example.com', arrivedVia: 'payment_link' });
    if ('refused' in paid) throw new Error(paid.refused);
    const arrived = await recordBusinessOutcome({ exposureId: EXPOSURE, kind: 'arrival', observedAt: new Date(), provider: 'stripe', providerRef: 'arr_g_1', payerReference: null });
    if ('refused' in arrived) throw new Error(arrived.refused);
    const ins = (over: Record<string, unknown>) => {
      const base: Record<string, unknown> = { id: nanoid(), founder_id: OWNER, experiment_id: X, exposure_id: EXPOSURE, payment_event_id: paid.id, provider: 'stripe', payment_ref: 'pi_g_1', amount_cents: 2900, currency: 'usd', ...over };
      const cols = Object.keys(base);
      return query(`INSERT INTO experiment_fulfilments (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((k) => base[k]));
    };
    await expect(ins({ status: 'sent' })).rejects.toThrow(/cannot_arrive_settled/);
    await expect(ins({ refund_ref: 're_x' })).rejects.toThrow(/cannot_arrive_settled/);
    await expect(ins({ payment_event_id: arrived.id })).rejects.toThrow(/payment_invalid/);
    await expect(ins({ payment_ref: 'pi_other' })).rejects.toThrow(/payment_invalid/);
    await expect(ins({ provider: 'paypal' })).rejects.toThrow(/payment_invalid/);
    await expect(ins({ founder_id: OTHER })).rejects.toThrow(/payment_invalid/);
    await expect(ins({ amount_cents: 0 })).rejects.toThrow(/CHECK|check/);
    await expect(ins({ id: 'g_f1' })).resolves.toBeDefined();
    await expect(ins({})).rejects.toThrow(/UNIQUE|unique/);
    await expect(query(`UPDATE experiment_fulfilments SET amount_cents = 1 WHERE id = 'g_f1'`)).rejects.toThrow(/immutable/);
    await expect(query(`UPDATE experiment_fulfilments SET refund_requested_at = datetime('now', '+1 day') WHERE id = 'g_f1'`)).rejects.toThrow(/request_in_the_future/);
    await expect(insertAction({ experiment_act: 'delivery', fulfilment_id: 'g_f1', id: 'g_deliver' })).resolves.toBeDefined();
    await expect(query(`UPDATE experiment_fulfilments SET status = 'delivered' WHERE id = 'g_f1'`)).resolves.toBeDefined();
    await expect(query(`UPDATE experiment_fulfilments SET status = 'owed' WHERE id = 'g_f1'`)).rejects.toThrow(/delivered_is_final/);
    await expect(insertAction({ experiment_act: 'delivery', fulfilment_id: 'g_f1' })).rejects.toThrow(/nothing_owed/);
    await expect(query(`UPDATE experiment_fulfilments SET status = 'refunded', refund_ref = 're_g' WHERE id = 'g_f1'`)).resolves.toBeDefined();
    await expect(query(`UPDATE experiment_fulfilments SET status = 'delivered' WHERE id = 'g_f1'`)).rejects.toThrow(/refund_is_final/);
  });

  it('once the test settled or its act was withdrawn, nothing more can be planned and nobody more reviewed', async () => {
    await query(`UPDATE proposed_acts SET revoked_at = datetime('now'), revoke_reason = 'stopped' WHERE id = ?`, [ACT]);
    await expect(insertAction({ recipient_id: 'g_r1', parameters_json: JSON.stringify({ to: ['a@shop.example'] }) })).rejects.toThrow(/not_authorised/);
    await query(`UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'over', verdict = 'surprised' WHERE id = ?`, [X]);
    await expect(insertAction({ recipient_id: 'g_r1', parameters_json: JSON.stringify({ to: ['a@shop.example'] }) })).rejects.toThrow(/experiment_not_live/);
    await expect(query(`UPDATE experiment_recipients SET review_status = 'approved', reviewed_by = 'founder:${OWNER}', reviewed_at = datetime('now') WHERE id = 'g_r_pending'`)).rejects.toThrow(/experiment_settled/);
    await expect(query(`INSERT INTO experiment_recipients (id, founder_id, experiment_id, counterparty_ref, email, channel) VALUES ('g_r_late', ?, ?, 'Late Shop', 'l@shop.example', 'email')`, [OWNER, X])).rejects.toThrow(/experiment_invalid/);
  });
});
