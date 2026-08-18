import { nanoid } from 'nanoid';
import { operatingProduct, query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';
import { recordReconstructionClaim } from './reconstruction.js';

export const ASSISTED_EMAIL_SCOPE='send_email:support_reply';
/** A founder-authored notice to a named recipient about a responsibility.
 * The same governed boundary, for a company whose work is not customer support. */
export const RESPONSIBILITY_NOTICE_SCOPE='send_email:responsibility_notice';
export type AssistedOutcome='unresolved'|'verified_success'|'verified_failure'|'conflicting';

/**
 * The live authority for one planned effect, or null.
 *
 * Mirrors migration 136's guard rather than restating a literal. Capability is
 * deliberately absent: what must hold is that the responsibility and its
 * consent AGREE about capability, not that the capability is customer support.
 * Hard-coding it here was the same defect as hard-coding it in the trigger, and
 * it would have made this the one place a dance school still could not act.
 *
 * The action, integration and scope must together be one declared effect kind,
 * so a caller cannot combine the action of one with the scope of another.
 */
async function currentAuthority(actionId:string):Promise<Record<string,unknown>|null> {
  const result=await query(`SELECT oa.* FROM outbound_actions oa
    JOIN institutional_responsibilities r ON r.id=oa.responsibility_id AND r.product_id=oa.product_id
    JOIN autonomy_consents a ON a.id=oa.authority_consent_id
    JOIN governed_effect_kinds k ON k.scope_key=oa.authority_scope
      AND k.action_type=oa.action_type AND k.integration_name=oa.integration_name
    JOIN products p ON p.id=oa.product_id
    WHERE oa.id=?
      -- BILLING ↔ CAPABILITY ACCESS. Cancelling a subscription paused the SCP
      -- agents at both levels and left institutional authority entirely alone,
      -- so a founder who had stopped paying still had emails sent on their
      -- behalf under a grant given while they were a customer. The pause
      -- reached the old layer and never learned about the new one.
      --
      -- Read here rather than by revoking the grants, because "you stopped
      -- paying" and "you withdrew permission" are different facts and this
      -- codebase already distinguishes them. Resubscribing restores the
      -- permission the founder already gave; it does not ask them to give it
      -- again, and a genuine revocation is still a revocation.
      --
      -- THE CANONICAL PREDICATE, not a hand-copied piece of it. This tested
      -- scp_status alone, and that was right until migration 145 gave
      -- commercial entitlement its own field: a cancelled subscription now
      -- writes entitlement_paused_at and leaves scp_status alone, so this
      -- predicate stopped seeing the exact case it was written for. A copied
      -- fragment of a rule drifts the moment the rule grows another axis.
      --
      -- operatingProduct() answers "may the institution act for this company
      -- now" across all three axes, and is the same predicate the gateway, the
      -- job work-lists and the scheduler read.
      AND ${operatingProduct('p')}
      AND r.state='assisting'
      AND r.authority_ref='autonomy_consent:' || a.id
      AND a.product_id=oa.product_id AND a.responsibility_id=r.id AND a.capability=r.capability
      AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
      AND a.consequence_boundary=k.consequence_boundary
      AND instr(a.allowed_scope_json,json_quote(oa.authority_scope))>0`,[actionId]);
  return result.rows[0] as Record<string,unknown>|undefined ?? null;
}

/** Create a bounded plan only. Dispatch is deliberately a separate call. */
export async function planAssistedSupportEmail(input:{productId:string;responsibilityId:string;authorityConsentId:string;
  effectId:string;to:string;subject:string;html:string;rationale:string;scope?:string}):Promise<string> {
  if (!input.effectId.trim() || !input.to.trim() || !input.subject.trim()) throw new Error('assisted action plan invalid');
  const scope=input.scope??ASSISTED_EMAIL_SCOPE;
  const id=nanoid();
  await query(`INSERT INTO outbound_actions
    (id,product_id,agent_name,integration_name,action_type,authority_level,status,parameters_json,preview_text,rationale,
     confidence,expires_at,responsibility_id,authority_consent_id,authority_scope,effect_id,outcome_status)
    VALUES (?,?,'institution:assisting','resend','send_email',0,'approved',?,?,?,?,datetime('now','+48 hours'),?,?,?,?,'unresolved')`,[
    id,input.productId,JSON.stringify({to:[input.to],subject:input.subject,html:input.html}),
    `Send bounded ${scope==='send_email:support_reply'?'support reply':'responsibility notice'} to ${input.to}`,
    input.rationale,1,input.responsibilityId,input.authorityConsentId,
    scope,input.effectId]);
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
  const result=await invoke({productId:String(row.product_id),tool:'send_email',action:`assisted ${row.authority_scope} ${row.effect_id}`,
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
  // Two shapes of independent evidence, read together.
  //
  // The support-specific pair came first and is kept because real rows may
  // exist under it. `effect_outcome_report` (migration 137) is the general
  // form: it works for any effect kind, carries its reporter, and is refused by
  // the database if the institution tries to report on itself. Before it, this
  // function could only ever return `unresolved`, because nothing in production
  // produced either support event.
  const observations=await query(`SELECT id,event_type,source,payload_json FROM signal_events WHERE product_id=?
    AND json_extract(payload_json,'$.effect_id')=?
    AND (event_type IN ('support_reply_effective','support_reply_failed') OR source='effect_outcome_report')
    ORDER BY id`,
    [productId,String(action.effect_id)]);

  // Normalised to success/failure regardless of which shape carried it, so a
  // company using the general form and a company using the legacy pair reach
  // the same verdict from the same reality.
  const verdicts=new Set((observations.rows as unknown as Record<string,unknown>[]).map(row=>{
    if (String(row.source)==='effect_outcome_report') {
      return String((JSON.parse(String(row.payload_json)) as {verdict?:string}).verdict)==='achieved'?'success':'failure';
    }
    return String(row.event_type)==='support_reply_effective'?'success':'failure';
  }));
  const outcome:AssistedOutcome=verdicts.size===0?'unresolved':verdicts.size>1?'conflicting':verdicts.has('success')?'verified_success':'verified_failure';
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

/**
 * SOURCE PROVENANCE SURVIVES INTO WHAT THE FOUNDER READS.
 *
 * `outcome_status` is a stored vocabulary whose success value is spelled
 * `verified_success`, and the founder-facing text used to render that as
 * "business outcome verified". It is not. One person or one system saying
 * "that worked" is a REPORT about an outcome, and it does not become an
 * independent verification by having arrived through an authenticated
 * endpoint — which is precisely the claim an outcome layer exists to refuse.
 *
 * The stored value is left alone: renaming it would touch migrations, guards
 * and readers for a vocabulary change, and the honest fix is smaller and
 * closer to the person being told. What changes is that the sentence names
 * WHO said it and how many said it, so "the owner told me" and "three
 * independent systems told me" stop reading identically.
 */
export async function getFounderAssistingActivity(productId:string):Promise<Array<{title:string;state:string;detail:string}>> {
  const result=await query(`SELECT r.title,oa.status,oa.effect_certainty,oa.outcome_status,oa.effect_id
    FROM outbound_actions oa JOIN institutional_responsibilities r ON r.id=oa.responsibility_id
    WHERE oa.product_id=? AND r.product_id=? ORDER BY oa.created_at DESC LIMIT 10`,[productId,productId]);
  const rows=result.rows as unknown as Record<string,unknown>[];

  // Who reported each outcome, so the sentence can say so.
  const reporters=new Map<string,string[]>();
  const effectIds=rows.map(row=>row.effect_id).filter(Boolean).map(String);
  if (effectIds.length) {
    const reports=await query(
      `SELECT json_extract(payload_json,'$.effect_id') e, json_extract(payload_json,'$.reporter') r
         FROM signal_events WHERE product_id=? AND source='effect_outcome_report'`,[productId]);
    for (const raw of reports.rows as unknown as Record<string,unknown>[]) {
      const key=String(raw.e); if (!effectIds.includes(key)) continue;
      reporters.set(key,[...(reporters.get(key)??[]),String(raw.r)]);
    }
  }

  /** "the owner", "a system you connected", or a count when several agree. */
  const attribution=(effectId:string):string=>{
    const who=reporters.get(effectId)??[];
    if (who.length===0) return 'somebody outside';
    if (who.length>1) return `${who.length} separate reports`;
    return who[0].startsWith('founder:')?'you told me':'a system you connected told me';
  };

  return rows.map(row=>{
    const certainty=String(row.effect_certainty??'not_attempted'); const outcome=String(row.outcome_status??'unresolved');
    const effectId=String(row.effect_id??'');
    const detail=outcome==='verified_success'?`${attribution(effectId)} it worked — reported, not independently confirmed`
      :outcome==='verified_failure'?`${attribution(effectId)} it did not work`
      :outcome==='conflicting'?'reports about this disagree; I have kept both and will not pick one'
      :certainty==='provider_acknowledged'?'provider accepted it; whether it worked is still unknown'
      :certainty==='ambiguous'?'dispatch is ambiguous and needs reconciliation'
      :String(row.status)==='approved'?'authorized to help with this bounded support reply; not yet performed'
      :'no consequential action was verified';
    return {title:String(row.title),state:String(row.status),detail};
  });
}
