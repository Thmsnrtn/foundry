import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';
import { recordReconstructionClaim } from './reconstruction.js';

export const ASSISTED_EMAIL_SCOPE='send_email:support_reply';
export type AssistedOutcome='unresolved'|'verified_success'|'verified_failure'|'conflicting';

async function currentAuthority(actionId:string):Promise<Record<string,unknown>|null> {
  const result=await query(`SELECT oa.* FROM outbound_actions oa
    JOIN institutional_responsibilities r ON r.id=oa.responsibility_id AND r.product_id=oa.product_id
    JOIN autonomy_consents a ON a.id=oa.authority_consent_id
    WHERE oa.id=? AND oa.action_type='send_email' AND oa.integration_name='resend'
      AND r.state='assisting' AND r.capability='customer_support'
      AND r.authority_ref='autonomy_consent:' || a.id
      AND a.product_id=oa.product_id AND a.responsibility_id=r.id AND a.capability=r.capability
      AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
      AND a.consequence_boundary='low' AND oa.authority_scope=?
      AND instr(a.allowed_scope_json,json_quote(oa.authority_scope))>0`,[actionId,ASSISTED_EMAIL_SCOPE]);
  return result.rows[0] as Record<string,unknown>|undefined ?? null;
}

/** Create a bounded plan only. Dispatch is deliberately a separate call. */
export async function planAssistedSupportEmail(input:{productId:string;responsibilityId:string;authorityConsentId:string;
  effectId:string;to:string;subject:string;html:string;rationale:string}):Promise<string> {
  if (!input.effectId.trim() || !input.to.trim() || !input.subject.trim()) throw new Error('assisted action plan invalid');
  const id=nanoid();
  await query(`INSERT INTO outbound_actions
    (id,product_id,agent_name,integration_name,action_type,authority_level,status,parameters_json,preview_text,rationale,
     confidence,expires_at,responsibility_id,authority_consent_id,authority_scope,effect_id,outcome_status)
    VALUES (?,?,'institution:assisting','resend','send_email',0,'approved',?,?,?,?,datetime('now','+48 hours'),?,?,?,?,'unresolved')`,[
    id,input.productId,JSON.stringify({to:[input.to],subject:input.subject,html:input.html}),
    `Send bounded support reply to ${input.to}`,input.rationale,1,input.responsibilityId,input.authorityConsentId,
    ASSISTED_EMAIL_SCOPE,input.effectId]);
  return id;
}

/** Revalidates authority, atomically claims the plan, then crosses the ordinary gateway. */
export async function executeAssistedSupportEmail(actionId:string, lifecycle:{afterClaim?:()=>Promise<void>}={}):Promise<{dispatched:boolean;certainty:string}> {
  const row=await currentAuthority(actionId);
  if (!row) return {dispatched:false,certainty:'not_attempted'};
  const claim=await query("UPDATE outbound_actions SET status='executing',approved_by='institution:assisting',approved_at=datetime('now') WHERE id=? AND status='approved'",[actionId]);
  if ((claim.rowsAffected??0)===0) {
    const replay=await query('SELECT effect_certainty FROM outbound_actions WHERE id=?',[actionId]);
    return {dispatched:false,certainty:String((replay.rows[0] as Record<string,unknown>|undefined)?.effect_certainty??'not_attempted')};
  }
  await lifecycle.afterClaim?.();
  // Revocation may race the claim; close the window before dispatch.
  if (!await currentAuthority(actionId)) {
    await query("UPDATE outbound_actions SET status='rejected',effect_certainty='not_attempted' WHERE id=?",[actionId]);
    return {dispatched:false,certainty:'not_attempted'};
  }
  const parameters=JSON.parse(String(row.parameters_json)) as {to:string[];subject:string;html:string};
  const result=await invoke({productId:String(row.product_id),tool:'send_email',action:`assisted support reply ${row.effect_id}`,
    params:parameters,dedupKey:String(row.effect_id),customerExternalId:parameters.to[0],surface:'email_outbound',dataClass:'customer'});
  if (!result.ok) {
    const ambiguous=result.phase==='execution';
    await query(`UPDATE outbound_actions SET status='failed',effect_certainty=?,provider_receipt_json=?,reconcile_after=? WHERE id=?`,
      [ambiguous?'ambiguous':'not_attempted',JSON.stringify({gateway_invocation_id:result.invocation_id,phase:result.phase,reason:result.reason}),
       ambiguous?new Date(Date.now()+15*60_000).toISOString():null,actionId]);
    return {dispatched:ambiguous,certainty:ambiguous?'ambiguous':'not_attempted'};
  }
  const provider=result.result as Record<string,unknown>;
  const acknowledged=provider && typeof provider.message_id==='string';
  await query(`UPDATE outbound_actions SET status=?,executed_at=datetime('now'),effect_certainty=?,provider_receipt_json=?,reconcile_after=? WHERE id=?`,[
    acknowledged?'executed':'failed',acknowledged?'provider_acknowledged':'not_attempted',
    JSON.stringify({gateway_invocation_id:result.invocation_id,cached:result.cached,provider}),
    acknowledged?new Date(Date.now()+15*60_000).toISOString():null,actionId]);
  return {dispatched:acknowledged,certainty:acknowledged?'provider_acknowledged':'not_attempted'};
}

/** Classify independently ingested canonical business evidence and learn without changing authority. */
export async function reconcileAssistedSupportEmail(productId:string,actionId:string):Promise<AssistedOutcome> {
  const action=(await query(`SELECT responsibility_id,effect_id,effect_certainty FROM outbound_actions
    WHERE id=? AND product_id=? AND responsibility_id IS NOT NULL`,[actionId,productId])).rows[0] as Record<string,unknown>|undefined;
  if (!action) throw new Error('assisted action not found');
  const observations=await query(`SELECT id,event_type FROM signal_events WHERE product_id=?
    AND json_extract(payload_json,'$.effect_id')=? AND event_type IN ('support_reply_effective','support_reply_failed') ORDER BY id`,
    [productId,String(action.effect_id)]);
  const kinds=new Set(observations.rows.map(row=>String((row as Record<string,unknown>).event_type)));
  const outcome:AssistedOutcome=kinds.size===0?'unresolved':kinds.size>1?'conflicting':kinds.has('support_reply_effective')?'verified_success':'verified_failure';
  let learnedClaimId:string|undefined;
  if (observations.rows.length) {
    const refs=observations.rows.map(row=>({kind:'signal_event' as const,id:String((row as Record<string,unknown>).id)}));
    learnedClaimId=await recordReconstructionClaim({productId,subject:`responsibility:${action.responsibility_id}`,
      predicate:`assisted_outcome:${action.effect_id}`,value:outcome,
      epistemicStatus:outcome==='conflicting'?'conflicting':'known',evidenceRefs:refs,
      derivationMethod:'deterministic assisted effect reconciliation',observedAt:new Date()});
  }
  await query(`UPDATE outbound_actions SET outcome_status=?,outcome_evidence_ref=?,learned_claim_id=?,reconcile_after=NULL WHERE id=?`,[
    outcome,observations.rows.length?observations.rows.map(row=>`signal_event:${(row as Record<string,unknown>).id}`).join(','):null,
    learnedClaimId??null,actionId]);
  return outcome;
}

export async function getFounderAssistingActivity(productId:string):Promise<Array<{title:string;state:string;detail:string}>> {
  const result=await query(`SELECT r.title,oa.status,oa.effect_certainty,oa.outcome_status
    FROM outbound_actions oa JOIN institutional_responsibilities r ON r.id=oa.responsibility_id
    WHERE oa.product_id=? AND r.product_id=? ORDER BY oa.created_at DESC LIMIT 10`,[productId,productId]);
  return (result.rows as unknown as Record<string,unknown>[]).map(row=>{
    const certainty=String(row.effect_certainty??'not_attempted'); const outcome=String(row.outcome_status??'unresolved');
    const detail=outcome==='verified_success'?'business outcome verified'
      :outcome==='verified_failure'?'business evidence shows the action failed'
      :outcome==='conflicting'?'business evidence conflicts; owner judgment may be needed'
      :certainty==='provider_acknowledged'?'provider accepted it; business outcome remains unresolved'
      :certainty==='ambiguous'?'dispatch is ambiguous and needs reconciliation'
      :String(row.status)==='approved'?'authorized to help with this bounded support reply; not yet performed'
      :'no consequential action was verified';
    return {title:String(row.title),state:String(row.status),detail};
  });
}
