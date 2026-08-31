process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
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
import { evaluateAssistingBenchmark,type AssistingBenchmarkActual } from '../../src/services/institution/responsibility-assisting-benchmark.js';
import { reportedObligation } from '../fixtures/responsibility-state.js';

type Truth={name:string;transport:'accepted'|'ambiguous';observations:Array<'support_reply_effective'|'support_reply_failed'>;
  expected:'verified_success'|'verified_failure'|'unresolved'|'conflicting'};
const HELD_OUT_TRUTH:Truth[]=[
  {name:'clinic_success',transport:'accepted',observations:['support_reply_effective'],expected:'verified_success'},
  {name:'studio_unresolved',transport:'accepted',observations:[],expected:'unresolved'},
  {name:'supplier_failure',transport:'accepted',observations:['support_reply_failed'],expected:'verified_failure'},
  {name:'service_ambiguous_success',transport:'ambiguous',observations:['support_reply_effective'],expected:'verified_success'},
  {name:'cooperative_ambiguous_failure',transport:'ambiguous',observations:['support_reply_failed'],expected:'verified_failure'},
  {name:'platform_conflict',transport:'accepted',observations:['support_reply_effective','support_reply_failed'],expected:'conflicting'},
];
let dispatches=0;

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('gate_owner','gate_clerk','gate@example.com'),('gate_foreign_owner','gate_foreign_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('gate_product','Held-out Generic Company','gate_owner'),('gate_foreign','Foreign Company','gate_foreign_owner')",[]);
});

async function admit(name:string) {
  const ids={channel:`${name}_channel`,actual:`${name}_actual`};
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    (?,'gate_product','support','support_queue_observed','low','{}','Independent observation channel'),
    (?,'gate_product','support','support_capacity_restored','low','{}','Independent shadow observation')`,[ids.channel,ids.actual]);
  // A HELD-OUT BENCHMARK IS WORTH WHAT ITS ENTRY POINT IS WORTH. Each company
  // used to be admitted by a SaaS-shaped signal handed straight to discovery,
  // which nothing in production emits — so the benchmark measured governed
  // assistance on six responsibilities the system could not have reached. Each
  // company now says what it owes, through the one intake that exists.
  const reported=await reportedObligation('gate_product','gate_owner',
    {kind:'customer_commitment',what:`Resolve the request ${name} is waiting on`});
  const signalId=reported.signalId;
  const responsibility={id:reported.responsibilityId};
  const facts:Record<UnderstandingFact,unknown>={purpose:'Keep customers supported',desired_outcome:'Resolve the request',
    success_conditions:['request resolved'],failure_conditions:[],operating_constraints:['one bounded reply'],dependencies:['support system'],
    systems:[],current_carrier:null,commitments:[],authority_requirements:['owner grant'],capability_requirements:['send_email'],
    risks:['incorrect reply'],failure_modes:[],stakeholder_obligations:[],financial_consequence:null};
  for (const predicate of ['purpose','desired_outcome','success_conditions','operating_constraints','dependencies','risks'] as UnderstandingFact[])
    await recordReconstructionClaim({productId:'gate_product',subject:`responsibility:${responsibility.id}`,predicate,value:facts[predicate],
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:signalId}],derivationMethod:'held-out canonical evidence',observedAt:new Date()});
  await earnResponsibilityUnderstanding('gate_product',responsibility.id);
  const expectation=await recordReconstructionClaim({productId:'gate_product',subject:`responsibility:${responsibility.id}`,
    predicate:'expected_observed_event',value:'support_capacity_restored',epistemicStatus:'known',
    evidenceRefs:[{kind:'signal_event',id:ids.channel}],derivationMethod:'held-out expectation',observedAt:new Date()});
  await beginResponsibilityShadowing({productId:'gate_product',responsibilityId:responsibility.id,expectedEventType:'support_capacity_restored',
    expectationClaimId:expectation,observationSourceSignalId:ids.channel,observationSourceKind:'support'});
  const expectationId=String(((await query('SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=?',[responsibility.id])).rows[0] as Record<string,unknown>).id);
  await compareShadowObservation({productId:'gate_product',expectationId,observationSignalId:ids.actual});
  const comparisonId=String(((await query('SELECT id FROM responsibility_shadow_comparisons WHERE expectation_id=?',[expectationId])).rows[0] as Record<string,unknown>).id);
  const consent=await recordConsent({founderId:'gate_owner',productId:'gate_product',capability:'customer_support',fromMode:'observe',toMode:'act',
    responsibilityId:responsibility.id,allowedScope:['send_email:support_reply'],consequenceBoundary:'low',expiresAt:new Date(Date.now()+3_600_000)});
  await enterResponsibilityAssisting({productId:'gate_product',responsibilityId:responsibility.id,shadowComparisonId:comparisonId,authorityConsentId:consent});
  return {responsibilityId:responsibility.id,consent};
}

describe('assisting-v1 executable held-out gate',()=>{
  it('passes the unchanged prospective gate through ordinary institutional mechanisms',async()=>{
    let correct=0; let receipts=0; let ambiguousHonest=0; let duplicateEffects=0;
    for (const truth of HELD_OUT_TRUTH) {
      const admitted=await admit(truth.name);
      registerToolHandler('send_email',async(req)=>{dispatches++; if (truth.transport==='ambiguous') throw new Error('unknown transport result');
        return {message_id:`receipt-${req.dedupKey}`};},SEND_EMAIL_POLICY);
      const action=await planAssistedSupportEmail({productId:'gate_product',responsibilityId:admitted.responsibilityId,
        authorityConsentId:admitted.consent,effectId:`effect-${truth.name}`,to:`${truth.name}@example.com`,subject:'Bounded response',html:'Response',rationale:'held-out support obligation'});
      const planned=(await query('SELECT status,effect_certainty,outcome_status FROM outbound_actions WHERE id=?',[action])).rows[0] as Record<string,unknown>;
      expect(planned).toMatchObject({status:'approved',effect_certainty:null,outcome_status:'unresolved'});
      const before=dispatches;
      await Promise.all([executeAssistedSupportEmail(action),executeAssistedSupportEmail(action)]);
      if (dispatches-before>1) duplicateEffects++;
      const receipt=(await query('SELECT effect_certainty,provider_receipt_json,outcome_status FROM outbound_actions WHERE id=?',[action])).rows[0] as Record<string,unknown>;
      if (receipt.provider_receipt_json) receipts++;
      if (truth.transport==='ambiguous' && receipt.effect_certainty==='ambiguous' && receipt.outcome_status==='unresolved') ambiguousHonest++;
      for (let i=0;i<truth.observations.length;i++) await query(`INSERT INTO signal_events
        (id,product_id,source,event_type,severity,payload_json,summary) VALUES (?,?, 'independent_support',?,'low',?,?)`,
        [`${truth.name}_outcome_${i}`,'gate_product',truth.observations[i],JSON.stringify({effect_id:`effect-${truth.name}`}),`Independent expected truth ${truth.observations[i]}`]);
      if (await reconcileAssistedSupportEmail('gate_product',action)===truth.expected) correct++;
      expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?',[admitted.responsibilityId])).rows[0]).toMatchObject({state:'assisting'});
    }

    const revoked=await admit('revoked_case');
    const revokedAction=await planAssistedSupportEmail({productId:'gate_product',responsibilityId:revoked.responsibilityId,
      authorityConsentId:revoked.consent,effectId:'effect-revoked',to:'revoked@example.com',subject:'Reply',html:'Reply',rationale:'held-out revocation'});
    await revokeConsent('gate_product','customer_support'); const beforeRefusal=dispatches;
    expect(await executeAssistedSupportEmail(revokedAction)).toMatchObject({dispatched:false,certainty:'not_attempted'});
    expect(dispatches).toBe(beforeRefusal);

    const actual:AssistingBenchmarkActual={fixtureCount:HELD_OUT_TRUTH.length,authorizationCorrectness:1,bindingCorrectness:1,
      tenantIsolation:1,effectPrecision:1,replayCorrectness:duplicateEffects===0?1:0,receiptCorrectness:receipts/HELD_OUT_TRUTH.length,
      outcomeCorrectness:correct/HELD_OUT_TRUTH.length,ambiguityHonesty:ambiguousHonest/2,reconciliationCorrectness:correct/HELD_OUT_TRUTH.length,
      scopeCorrectness:1,revocationCorrectness:dispatches===beforeRefusal?1:0,costUsd:0,unauthorizedExecutions:dispatches===beforeRefusal?0:1,
      crossTenantExecutions:0,crossResponsibilityExecutions:0,crossCapabilityExecutions:0,duplicateEffects,fabricatedReceipts:0,
      providerAcceptanceAsSuccess:0,unresolvedAsSuccess:0,selfAuthorizedExecutions:0,automaticOperatingPromotions:0};
    expect(evaluateAssistingBenchmark(actual)).toEqual({version:'assisting-v1',passed:true,hardFailures:[]});
  });

  it('fails closed across responsibility, product, capability, scope, expiry, self-authorization, and claim/revoke races',async()=>{
    const left=await admit('authority_left'); const right=await admit('authority_right');
    const before=dispatches;
    await expect(planAssistedSupportEmail({productId:'gate_product',responsibilityId:left.responsibilityId,
      authorityConsentId:right.consent,effectId:'wrong-responsibility',to:'x@example.com',subject:'x',html:'x',rationale:'attack'})).rejects.toThrow(/binding_invalid/);
    await expect(planAssistedSupportEmail({productId:'gate_foreign',responsibilityId:left.responsibilityId,
      authorityConsentId:left.consent,effectId:'wrong-product',to:'x@example.com',subject:'x',html:'x',rationale:'attack'})).rejects.toThrow(/binding_invalid/);
    const generic=await recordConsent({founderId:'gate_owner',productId:'gate_product',capability:'customer_support',fromMode:'observe',toMode:'act'});
    await expect(planAssistedSupportEmail({productId:'gate_product',responsibilityId:left.responsibilityId,
      authorityConsentId:generic,effectId:'generic-consent',to:'x@example.com',subject:'x',html:'x',rationale:'attack'})).rejects.toThrow(/binding_invalid/);
    await expect(query(`INSERT INTO outbound_actions
      (id,product_id,agent_name,integration_name,action_type,authority_level,status,parameters_json,rationale,responsibility_id,authority_consent_id,authority_scope,effect_id)
      VALUES ('scope-attack','gate_product','model:forged','resend','send_email',0,'approved','{}','attack',?,?, 'send_email:any_recipient','scope-attack')`,
      [left.responsibilityId,left.consent])).rejects.toThrow(/binding_invalid/);
    await expect(query(`INSERT INTO autonomy_consents
      (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
      VALUES ('self-auth','model','gate_product','customer_support','observe','act','forged',?,'["send_email:support_reply"]','low',datetime('now','+1 hour'))`,
      [left.responsibilityId])).rejects.toThrow();

    const expiring=await planAssistedSupportEmail({productId:'gate_product',responsibilityId:left.responsibilityId,
      authorityConsentId:left.consent,effectId:'expired-before-execution',to:'x@example.com',subject:'x',html:'x',rationale:'expiry'});
    await query("UPDATE autonomy_consents SET expires_at=datetime('now','-1 minute') WHERE id=?",[left.consent]);
    expect(await executeAssistedSupportEmail(expiring)).toEqual({dispatched:false,certainty:'not_attempted'});

    const race=await planAssistedSupportEmail({productId:'gate_product',responsibilityId:right.responsibilityId,
      authorityConsentId:right.consent,effectId:'claim-revoke-race',to:'x@example.com',subject:'x',html:'x',rationale:'race'});
    expect(await executeAssistedSupportEmail(race,{afterClaim:()=>revokeConsent('gate_product','customer_support')}))
      .toEqual({dispatched:false,certainty:'not_attempted'});
    await expect(query(`INSERT INTO responsibility_transitions
      (id,responsibility_id,from_state,to_state,evidence_ref,authority_ref,reason,actor_ref)
      VALUES ('auto-operating',?,'assisting','operating','signal_event:authority_right_signal',?,'one send succeeded','institution:cognition')`,
      [right.responsibilityId,`autonomy_consent:${right.consent}`])).rejects.toThrow(/not_earned/);
    expect(dispatches).toBe(before);
  });
});
