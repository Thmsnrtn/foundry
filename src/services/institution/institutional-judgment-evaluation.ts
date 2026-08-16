import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { recordReconstructionClaim } from './reconstruction.js';
export type JudgmentEvaluationState='not_yet_observable'|'insufficient_evidence'|'partially_observed'|'supported'|'contradicted'|'mixed'|'conflicting';

export async function evaluateInstitutionalJudgment(productId:string,judgmentId:string):Promise<JudgmentEvaluationState>{
 const judgment=(await query('SELECT id FROM strategic_decisions_log WHERE id=? AND product_id=?',[judgmentId,productId])).rows[0];
 if(!judgment) throw new Error('judgment evaluation refused');
 const observations=await query(`SELECT id,event_type,payload_json FROM signal_events WHERE product_id=?
  AND json_extract(payload_json,'$.judgment_id')=? AND event_type IN
  ('judgment_partially_observed','judgment_expected_supported','judgment_expected_contradicted') ORDER BY id`,[productId,judgmentId]);
 const kinds=new Set(observations.rows.map(r=>String((r as Record<string,unknown>).event_type)));
 let state:JudgmentEvaluationState=!kinds.size?'not_yet_observable':kinds.has('judgment_expected_supported')&&kinds.has('judgment_expected_contradicted')?'conflicting':
  kinds.has('judgment_expected_supported')?'supported':kinds.has('judgment_expected_contradicted')?'contradicted':'partially_observed';
 const refs=observations.rows.map(r=>({kind:'signal_event' as const,id:String((r as Record<string,unknown>).id)}));
 let learned:string|undefined;
 if(refs.length) learned=await recordReconstructionClaim({productId,subject:`judgment:${judgmentId}`,predicate:'later_reality_comparison',value:state,
  epistemicStatus:state==='conflicting'?'conflicting':'known',evidenceRefs:refs,derivationMethod:'bounded later-reality comparison',observedAt:new Date()});
 const economics=observations.rows.map(r=>{try{return JSON.parse(String((r as Record<string,unknown>).payload_json)).economic_result;}catch{return undefined;}}).filter(x=>x!==undefined);
 await query(`INSERT INTO institutional_judgment_evaluations
  (id,judgment_id,product_id,state,evidence_refs_json,economic_result_json,learned_claim_id) VALUES (?,?,?,?,?,?,?)`,
  [nanoid(),judgmentId,productId,state,JSON.stringify(refs.map(r=>`signal_event:${r.id}`)),JSON.stringify(economics.length?{status:'observed',values:economics}:{status:'unknown',value:null}),learned??null]);
 return state;
}
