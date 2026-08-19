process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding,type UnderstandingFact } from '../../src/services/institution/responsibility-understanding.js';
import { beginResponsibilityShadowing,compareShadowObservation } from '../../src/services/institution/responsibility-shadowing.js';
import { recordConsent,revokeConsent } from '../../src/services/autopilot/consent.js';
import { enterResponsibilityAssisting } from '../../src/services/institution/responsibility-assisting.js';
import { executeAssistedSupportEmail,planAssistedSupportEmail,reconcileAssistedSupportEmail } from '../../src/services/institution/responsibility-assisted-email.js';
import { reportedObligation } from '../fixtures/responsibility-state.js';

let dispatches=0;
beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('ae_owner','ae_clerk','owner@example.com'),('ae_foreign_owner','aef_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('ae_product','Generic Support Co','ae_owner'),('ae_foreign','Foreign Co','ae_foreign_owner')",[]);
});
beforeEach(()=>{
  dispatches=0;
  registerToolHandler('send_email',async(req)=>{dispatches++; return {message_id:`provider-${req.dedupKey}`};},SEND_EMAIL_POLICY);
});

async function buildVertical(suffix:string) {
  const channel=`channel_${suffix}`; const actual=`actual_${suffix}`;
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    (?,'ae_product','support','support_queue_observed','low','{}','Independent channel'),
    (?,'ae_product','support','support_capacity_restored','low','{}','Capacity restored')`,[channel,actual]);
  // THE WHOLE VERTICAL STARTS AT THE DOOR PRODUCTION HAS. This used to emit a
  // SaaS-shaped signal and hand it to discovery — an event type nothing in this
  // system produces — so the first governed assisted execution was demonstrated
  // on a responsibility the running system could not have.
  const reported=await reportedObligation('ae_product','ae_owner',
        // One obligation per vertical. The same words reported twice are now ONE
    // responsibility — discovery converges them — so each of these cases has to
    // be a genuinely different thing the company owes, which is what it is.
    {kind:'customer_commitment',what:`Answer the people waiting in the support queue (${suffix})`});
  const signal=reported.signalId;
  const responsibility={id:reported.responsibilityId};
  const facts:Record<UnderstandingFact,unknown>={purpose:'Keep customers supported',desired_outcome:'Restore response capacity',
    success_conditions:['customer receives reply'],failure_conditions:[],operating_constraints:['one low-risk reply'],
    dependencies:['support inbox'],systems:[],current_carrier:null,commitments:[],authority_requirements:['explicit'],
    capability_requirements:['send_email'],risks:['wrong recipient'],failure_modes:[],stakeholder_obligations:[],financial_consequence:null};
  let purposeClaim='';
  for (const predicate of ['purpose','desired_outcome','success_conditions','operating_constraints','dependencies','risks'] as UnderstandingFact[]) {
    const id=await recordReconstructionClaim({productId:'ae_product',subject:`responsibility:${responsibility.id}`,predicate,
      value:facts[predicate],epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:signal}],derivationMethod:'vertical fixture evidence',observedAt:new Date()});
    if (predicate==='purpose') purposeClaim=id;
  }
  await earnResponsibilityUnderstanding('ae_product',responsibility.id);
  const expectationClaim=await recordReconstructionClaim({productId:'ae_product',subject:`responsibility:${responsibility.id}`,
    predicate:'expected_observed_event',value:'support_capacity_restored',epistemicStatus:'known',
    evidenceRefs:[{kind:'signal_event',id:channel}],derivationMethod:'bounded expectation',observedAt:new Date()});
  await beginResponsibilityShadowing({productId:'ae_product',responsibilityId:responsibility.id,
    expectedEventType:'support_capacity_restored',expectationClaimId:expectationClaim,observationSourceSignalId:channel});
  const expectation=(await query('SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=?',[responsibility.id])).rows[0] as Record<string,unknown>;
  await compareShadowObservation({productId:'ae_product',expectationId:String(expectation.id),observationSignalId:actual});
  const comparison=(await query('SELECT id FROM responsibility_shadow_comparisons WHERE expectation_id=?',[expectation.id])).rows[0] as Record<string,unknown>;
  const consent=await recordConsent({founderId:'ae_owner',productId:'ae_product',capability:'customer_support',fromMode:'observe',toMode:'act',
    responsibilityId:responsibility.id,allowedScope:['send_email:support_reply'],consequenceBoundary:'low',expiresAt:new Date(Date.now()+3_600_000)});
  await enterResponsibilityAssisting({productId:'ae_product',responsibilityId:responsibility.id,
    shadowComparisonId:String(comparison.id),authorityConsentId:consent});
  return {responsibilityId:responsibility.id,consent,purposeClaim};
}

describe('first governed responsibility-bound assisted execution',()=>{
  it('runs the ordinary evidence-to-assistance vertical and keeps receipt, outcome, learning, and maturity distinct',async()=>{
    const vertical=await buildVertical('success');
    const action=await planAssistedSupportEmail({productId:'ae_product',responsibilityId:vertical.responsibilityId,
      authorityConsentId:vertical.consent,effectId:'support-reply-success',to:'customer@example.com',subject:'We are on it',html:'Help is underway',rationale:'Restore bounded support communication'});
    const before=(await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?',['ae_product'])).rows[0];
    const replay=await Promise.all([executeAssistedSupportEmail(action),executeAssistedSupportEmail(action)]);
    expect(replay).toContainEqual({dispatched:true,certainty:'provider_acknowledged'});
    expect(replay).toContainEqual({dispatched:false,certainty:'not_attempted'});
    expect(await executeAssistedSupportEmail(action)).toEqual({dispatched:false,certainty:'provider_acknowledged'});
    expect(dispatches).toBe(1);
    const receipt=(await query('SELECT * FROM outbound_actions WHERE id=?',[action])).rows[0] as Record<string,unknown>;
    expect(receipt).toMatchObject({responsibility_id:vertical.responsibilityId,authority_consent_id:vertical.consent,
      authority_scope:'send_email:support_reply',effect_id:'support-reply-success',effect_certainty:'provider_acknowledged',outcome_status:'unresolved'});
    expect(receipt.provider_receipt_json).toContain('provider-support-reply-success');
    expect(await reconcileAssistedSupportEmail('ae_product',action)).toBe('unresolved');
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('effective_success','ae_product','support_system','support_reply_effective','low','{"effect_id":"support-reply-success"}','Customer request resolved after reply')`,[]);
    expect(await reconcileAssistedSupportEmail('ae_product',action)).toBe('verified_success');
    const after=(await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?',['ae_product'])).rows[0];
    expect(after).toEqual(before);
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?',[vertical.responsibilityId])).rows[0]).toMatchObject({state:'assisting'});
    expect((await query('SELECT outcome_status,learned_claim_id FROM outbound_actions WHERE id=?',[action])).rows[0]).toMatchObject({outcome_status:'verified_success',learned_claim_id:expect.any(String)});
  });

  it('revalidates revocation, rejects scope/effect collisions, and converges replay with zero extra effect',async()=>{
    const vertical=await buildVertical('attack');
    const action=await planAssistedSupportEmail({productId:'ae_product',responsibilityId:vertical.responsibilityId,
      authorityConsentId:vertical.consent,effectId:'support-reply-attack',to:'customer2@example.com',subject:'Update',html:'Update',rationale:'bounded'});
    await revokeConsent('ae_product','customer_support');
    expect(await executeAssistedSupportEmail(action)).toEqual({dispatched:false,certainty:'not_attempted'});
    expect(dispatches).toBe(0);
    await expect(planAssistedSupportEmail({productId:'ae_product',responsibilityId:vertical.responsibilityId,
      authorityConsentId:vertical.consent,effectId:'collision',to:'x@example.com',subject:'x',html:'x',rationale:'x'})).rejects.toThrow(/binding_invalid/);
  });

  it('preserves verified failure and conflicting evidence after provider acknowledgement',async()=>{
    const vertical=await buildVertical('failure');
    const action=await planAssistedSupportEmail({productId:'ae_product',responsibilityId:vertical.responsibilityId,
      authorityConsentId:vertical.consent,effectId:'support-reply-failure',to:'customer3@example.com',subject:'Update',html:'Update',rationale:'bounded'});
    await executeAssistedSupportEmail(action);
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
      ('rejected_failure','ae_product','support_system','support_reply_failed','high','{"effect_id":"support-reply-failure"}','Customer request remained unresolved')`,[]);
    expect(await reconcileAssistedSupportEmail('ae_product',action)).toBe('verified_failure');
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('effective_failure','ae_product','support_system','support_reply_effective','low','{"effect_id":"support-reply-failure"}','Conflicting resolution evidence')`,[]);
    expect(await reconcileAssistedSupportEmail('ae_product',action)).toBe('conflicting');
  });

  it('keeps a transport failure ambiguous until independent reconciliation finds success',async()=>{
    const vertical=await buildVertical('ambiguous');
    registerToolHandler('send_email',async()=>{dispatches++; throw new Error('transport timeout');},SEND_EMAIL_POLICY);
    const action=await planAssistedSupportEmail({productId:'ae_product',responsibilityId:vertical.responsibilityId,
      authorityConsentId:vertical.consent,effectId:'support-reply-ambiguous',to:'customer4@example.com',subject:'Update',html:'Update',rationale:'bounded'});
    expect(await executeAssistedSupportEmail(action)).toEqual({dispatched:true,certainty:'ambiguous'});
    expect((await query('SELECT outcome_status FROM outbound_actions WHERE id=?',[action])).rows[0]).toMatchObject({outcome_status:'unresolved'});
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('effective_ambiguous','ae_product','support_system','support_reply_effective','low','{"effect_id":"support-reply-ambiguous"}','Customer request independently observed resolved')`,[]);
    expect(await reconcileAssistedSupportEmail('ae_product',action)).toBe('verified_success');
  });
});
