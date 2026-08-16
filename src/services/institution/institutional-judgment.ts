import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { getReconstructionClaims } from './reconstruction.js';

type Demand={resource:string;amount:number;deadline?:string;consequence?:string};
export async function createDeterministicCapacityJudgment(productId:string,responsibilityIds:string[]):Promise<string|null> {
  const ids=[...new Set(responsibilityIds)]; if (ids.length<2) return null;
  const responsibilities=await query(`SELECT id,title FROM institutional_responsibilities WHERE product_id=?
    AND id IN (${ids.map(()=>'?').join(',')})`,[productId,...ids]);
  if (responsibilities.rows.length!==ids.length) throw new Error('institutional judgment tenant boundary');
  const claims=await getReconstructionClaims(productId);
  const capacities=new Map<string,{amount:number;claimId:string}>(); const demands:Array<Demand&{responsibilityId:string;claimId:string}>=[];
  const commitments:Array<{kind:string;text:string;claimId:string}>=[]; const ownerConstraints:Array<{text:string;claimId:string}>=[];
  const economics:Array<{status:string;value:unknown;claimId:string}>=[];
  for (const claim of claims) {
    if (claim.subject===`product:${productId}` && claim.predicate==='resource_capacity' && claim.epistemicStatus==='known') {
      const value=claim.value as {resource?:unknown;amount?:unknown};
      if (typeof value?.resource==='string'&&typeof value.amount==='number') capacities.set(value.resource,{amount:value.amount,claimId:claim.id});
    }
    if (claim.predicate==='commitment' && ['known','inferred'].includes(claim.epistemicStatus)) {
      const value=claim.value as {kind?:unknown;text?:unknown};
      if(typeof value?.kind==='string'&&typeof value.text==='string') commitments.push({kind:value.kind,text:value.text,claimId:claim.id});
    }
    if (claim.predicate==='owner_constraint' && claim.epistemicStatus==='known') {
      const value=claim.value as {text?:unknown}; if(typeof value?.text==='string') ownerConstraints.push({text:value.text,claimId:claim.id});
    }
    if (claim.predicate==='economic_evidence') economics.push({status:claim.epistemicStatus,value:claim.value,claimId:claim.id});
    const responsibilityId=ids.find(id=>claim.subject===`responsibility:${id}`);
    if (responsibilityId&&claim.predicate==='resource_demand'&&['known','inferred'].includes(claim.epistemicStatus)) {
      const value=claim.value as Partial<Demand>;
      if (typeof value?.resource==='string'&&typeof value.amount==='number') demands.push({...value,resource:value.resource,amount:value.amount,responsibilityId,claimId:claim.id});
    }
  }
  const conflict=[...capacities].find(([resource,capacity])=>demands.filter(d=>d.resource===resource).reduce((n,d)=>n+d.amount,0)>capacity.amount);
  if (!conflict) return null;
  const [resource,capacity]=conflict; const affected=demands.filter(d=>d.resource===resource);
  const relevantCommitments=commitments.filter(c=>c.kind==='hard_external');
  const evidence=[capacity.claimId,...affected.map(d=>d.claimId),...commitments.map(c=>c.claimId),...ownerConstraints.map(c=>c.claimId),...economics.map(e=>e.claimId)]; const id=nanoid();
  const economicStatuses=new Set(economics.map(e=>e.status));
  const economicEffect=economics.length===1&&['known','inferred'].includes(economics[0].status)
    ?{status:economics[0].status==='known'?'observed':'inferred_estimate',value:economics[0].value}
    :{status:economics.length===0?'unknown':economicStatuses.size>1||economicStatuses.has('conflicting')?'conflicting':'unknown',value:null};
  await query(`INSERT INTO strategic_decisions_log
    (id,product_id,decision_title,decision_description,decision_rationale,expected_outcome,decision_category,made_by,status,
     agent_context_json,alternatives_considered_json,key_assumptions_json,responsibility_refs_json,evidence_refs_json,
     constraints_json,uncertainties_json,consequences_json,reversible,expected_economic_effect_json,authority_required_json)
    VALUES (?,?,?,?,?,?,'operations','agent_recommendation','active','{}',?,?,?,?,?,?,?,1,?,?)`,[
    id,productId,`Resolve shared ${resource} capacity conflict`,
    `${affected.length} responsibilities demand more ${resource} than current canonical capacity`,
    'Deterministic comparison of provenance-bearing capacity and demand claims',
    'Owner selects a bounded allocation or changes capacity',JSON.stringify(['defer one demand','reallocate capacity','increase capacity']),
    JSON.stringify([`capacity for ${resource} remains current`]),JSON.stringify(ids),JSON.stringify(evidence.map(x=>`reconstruction_claim:${x}`)),
    JSON.stringify([{kind:'resource_limit',resource,available:capacity.amount,requested:affected.reduce((n,d)=>n+d.amount,0)},
      ...relevantCommitments.map(c=>({kind:c.kind,text:c.text})),...ownerConstraints.map(c=>({kind:'owner_constraint',text:c.text}))]),
    JSON.stringify([...affected.filter(d=>!d.deadline).map(d=>`deadline unknown for ${d.responsibilityId}`),
      ...commitments.filter(c=>c.kind==='unknown').map(c=>`commitment status unknown: ${c.text}`),
      ...(economicEffect.status==='unknown'||economicEffect.status==='conflicting'?[`economic ordering ${economicEffect.status}`]:[])]),
    JSON.stringify(affected.map(d=>({responsibilityId:d.responsibilityId,consequence:d.consequence??'unknown'}))),
    JSON.stringify(economicEffect),JSON.stringify({required:true,reason:'judgment cannot allocate or execute'}),
  ]);
  return id;
}
