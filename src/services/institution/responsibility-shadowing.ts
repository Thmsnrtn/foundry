import { nanoid } from 'nanoid';
import { batch,query } from '../../db/client.js';
import { getResponsibility,type Responsibility } from './responsibility.js';

export async function beginResponsibilityShadowing(input:{productId:string;responsibilityId:string;
  expectedEventType:string;expectationClaimId:string;observationSourceSignalId:string;validUntil?:Date}):Promise<Responsibility> {
  const expectationId=nanoid();
  await batch([
    {sql:`INSERT INTO responsibility_shadow_expectations
      (id,responsibility_id,product_id,expected_event_type,expectation_evidence_ref,observation_source_evidence_ref,valid_until)
      VALUES (?,?,?,?,?,?,?)`,args:[expectationId,input.responsibilityId,input.productId,input.expectedEventType.trim(),
      `reconstruction_claim:${input.expectationClaimId}`,`signal_event:${input.observationSourceSignalId}`,input.validUntil?.toISOString()??null]},
    {sql:`INSERT INTO responsibility_transitions
      (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
      VALUES (?,?,'understood','shadowing',?,?,?)`,args:[nanoid(),input.responsibilityId,
      `signal_event:${input.observationSourceSignalId}`,'A current independent observation channel can test a bounded expectation',
      'institution:shadow_observer']},
  ]);
  return getResponsibility(input.productId,input.responsibilityId) as Promise<Responsibility>;
}

export async function compareShadowObservation(input:{productId:string;expectationId:string;observationSignalId:string;
  learnedClaimId?:string}):Promise<'matched'|'deviated'|'unresolved'> {
  const expectation=await query(`SELECT expected_event_type,valid_until FROM responsibility_shadow_expectations
    WHERE id=? AND product_id=?`,[input.expectationId,input.productId]);
  if (!expectation.rows.length) throw new Error('shadow comparison refused');
  const observed=await query('SELECT event_type FROM signal_events WHERE id=? AND product_id=?',
    [input.observationSignalId,input.productId]);
  if (!observed.rows.length) throw new Error('shadow comparison refused');
  const row=expectation.rows[0] as Record<string,unknown>;
  const expired=row.valid_until!=null && new Date(String(row.valid_until))<=new Date();
  const classification=expired?'unresolved':String((observed.rows[0] as Record<string,unknown>).event_type)===String(row.expected_event_type)
    ?'matched':'deviated';
  try {
    await query(`INSERT INTO responsibility_shadow_comparisons
      (id,expectation_id,product_id,observation_ref,classification,learned_claim_id) VALUES (?,?,?,?,?,?)`,
    [nanoid(),input.expectationId,input.productId,`signal_event:${input.observationSignalId}`,classification,input.learnedClaimId??null]);
  } catch (error) {
    const replay=await query(`SELECT classification FROM responsibility_shadow_comparisons
      WHERE expectation_id=? AND observation_ref=?`,[input.expectationId,`signal_event:${input.observationSignalId}`]);
    if (!replay.rows.length) throw error;
    return String((replay.rows[0] as Record<string,unknown>).classification) as typeof classification;
  }
  return classification;
}

export async function getMaterialShadowingExceptions(productId:string):Promise<Array<{
  responsibilityId:string;title:string;expectedEventType:string;observedSummary:string;classification:'deviated'|'unresolved';
}>> {
  const result=await query(`SELECT r.id AS responsibility_id,r.title,x.expected_event_type,e.summary,c.classification
    FROM responsibility_shadow_comparisons c
    JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
    JOIN institutional_responsibilities r ON r.id=x.responsibility_id
    JOIN signal_events e ON c.observation_ref='signal_event:' || e.id
    WHERE c.product_id=? AND r.product_id=? AND c.classification IN ('deviated','unresolved')
    ORDER BY c.created_at DESC`,[productId,productId]);
  return (result.rows as unknown as Array<Record<string,unknown>>).map((row)=>({responsibilityId:String(row.responsibility_id),
    title:String(row.title),expectedEventType:String(row.expected_event_type),observedSummary:String(row.summary),
    classification:row.classification as 'deviated'|'unresolved'}));
}
