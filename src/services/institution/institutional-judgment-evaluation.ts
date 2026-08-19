import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { getReconstructionClaims, recordReconstructionClaim } from './reconstruction.js';
import { findCapacityConflict, readCapacityView } from './institutional-judgment.js';
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

/** Later-reality observation pass.
 *
 * Foundry raised a judgment saying a resource was over-subscribed and that the
 * owner would have to allocate or change capacity. This asks the only question
 * it can answer honestly: has the company since said something that settles it?
 *
 * Three disciplines make the answer trustworthy rather than convenient:
 *
 *   • Only claims recorded STRICTLY AFTER the judgment count. Evidence must
 *     follow the prediction it tests; migration 124 refuses an observation that
 *     cites anything older, and same-second evidence is refused as ambiguous
 *     rather than believed.
 *   • The observer recomputes with the SAME reading the producer used, so a
 *     disagreement is always about the company and never about the code.
 *   • It reports `contradicted` only against a passed deadline. A conflict that
 *     still stands has not falsified anything — the owner may simply not have
 *     acted yet — so the
 *     honest report is `partially_observed` — UNLESS a date the company itself
 *     gave has passed with the conflict still standing, which is the one case
 *     where "not yet" and "too late" can be told apart. That observer did not
 *     exist until migration 166 gave a responsibility a stated due date, and
 *     the impossibility was carried as proof debt rather than faked.
 */
export async function runJudgmentObservationPass(
  productId:string,
):Promise<Array<{judgmentId:string;observed:JudgmentEvaluationState}>> {
  const judgments=await query(
    `SELECT id,made_at,responsibility_refs_json FROM strategic_decisions_log
      WHERE product_id=? AND conflict_identity IS NOT NULL ORDER BY made_at,id`,[productId]);
  const out:Array<{judgmentId:string;observed:JudgmentEvaluationState}>=[];
  for (const row of judgments.rows as unknown as Array<Record<string,unknown>>) {
    const judgmentId=String(row.id);
    let responsibilityIds:string[]=[];
    try { responsibilityIds=JSON.parse(String(row.responsibility_refs_json)) as string[]; } catch { continue; }
    if (!Array.isArray(responsibilityIds)||responsibilityIds.length<2) continue;

    const newer=await query(
      `SELECT id FROM reconstruction_claims WHERE product_id=?
         AND predicate IN ('resource_capacity','resource_demand')
         AND datetime(created_at)>datetime(?) ORDER BY created_at,id`,[productId,String(row.made_at)]);
    const evidenceClaimIds=(newer.rows as unknown as Array<Record<string,unknown>>).map(r=>String(r.id));
    if (!evidenceClaimIds.length) continue; // not yet observable — say nothing

    const view=readCapacityView(await getReconstructionClaims(productId),productId,responsibilityIds);
    const resolved=findCapacityConflict(view)===null;

    // THE DEADLINE THAT MAKES CONTRADICTION HONEST.
    //
    // This could never report `contradicted`, and said why: a conflict that
    // still stands has not falsified anything, because the owner may simply
    // not have acted yet. That was true for as long as the institution had no
    // way to tell "not yet" from "too late" — recorded as proof debt rather
    // than faked.
    //
    // Migration 166 gave a responsibility a due date the COMPANY stated, which
    // the database refuses to let Foundry author. So the missing distinction
    // now exists: a conflict still standing after a date the company itself
    // gave is not an owner who has not got to it. The time they had ran out,
    // and the judgment that said this would have to be allocated or resolved
    // has been falsified by events rather than by opinion.
    //
    // Deliberately strict. It needs a date, the date must be past, and the
    // conflict must still stand. Any of those missing and the honest report is
    // still `partially_observed` — an absent deadline is not a met one.
    const overdue=responsibilityIds.length?(await query(
      `SELECT id,title,due_at FROM institutional_responsibilities
        WHERE product_id=? AND id IN (${responsibilityIds.map(()=>'?').join(',')})
          AND due_at IS NOT NULL AND datetime(due_at)<datetime('now')
        ORDER BY due_at LIMIT 1`,[productId,...responsibilityIds])).rows[0] as Record<string,unknown>|undefined
      :undefined;

    const eventType=resolved?'judgment_expected_supported'
      :overdue?'judgment_expected_contradicted':'judgment_partially_observed';
    const observationId='jobs_'+createHash('sha256')
      .update([judgmentId,eventType,...evidenceClaimIds,
        overdue?`due:${String(overdue.id)}:${String(overdue.due_at)}`:''].join('\n')).digest('hex').slice(0,32);

    // The same evidence re-read on a later tick is the same observation, not a
    // new one. Only genuinely new evidence appends to the judgment's history.
    const seen=await query('SELECT id FROM signal_events WHERE id=?',[observationId]);
    if (seen.rows.length) continue;

    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,'institutional_judgment_observation',?,?,?,?)`,[
      observationId,productId,eventType,resolved?'low':'medium',
      JSON.stringify({judgment_id:judgmentId,evidence_claim_ids:evidenceClaimIds,resolved,
        // The date is carried on the observation, so the reason a judgment was
        // contradicted survives longer than the row that was overdue.
        ...(overdue?{overdue_responsibility_id:String(overdue.id),overdue_due_at:String(overdue.due_at)}:{})}),
      resolved
        ?'The resource conflict this judgment was about no longer stands'
        :overdue
          ?`The conflict still stands, and ${String(overdue.title)} passed the date you gave for it`
          :'The resource conflict this judgment was about still stands',
    ]);
    out.push({judgmentId,observed:await evaluateInstitutionalJudgment(productId,judgmentId)});
  }
  return out;
}
