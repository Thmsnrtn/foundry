import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { getReconstructionClaims } from './reconstruction.js';

type Demand={resource:string;amount:number;deadline?:string;consequence?:string};

/** A conflict is a resource plus the exact set of responsibilities contending
 * for it. Two different affected sets are two different conflicts with
 * different consequences and different alternatives, so they are not collapsed
 * into one identity for convenience. Migration 124 makes this unique per
 * product: a standing conflict has one judgment, and later reality is appended
 * beside it rather than raised again as a fresh row. */
function conflictIdentity(resource:string,responsibilityIds:string[]):string {
  const digest=createHash('sha256').update([...responsibilityIds].sort().join('\n')).digest('hex');
  return `capacity:${resource}:${digest.slice(0,16)}`;
}
export interface CapacityView {
  capacities:Map<string,{amount:number;claimId:string}>;
  demands:Array<Demand&{responsibilityId:string;claimId:string}>;
  commitments:Array<{kind:string;text:string;claimId:string}>;
  ownerConstraints:Array<{text:string;claimId:string}>;
  economics:Array<{status:string;value:unknown;claimId:string}>;
}

/** The single reading of capacity and demand from provenance-bearing claims.
 * Both the judgment producer and the later-reality observer use it, so an
 * observation can never disagree with the judgment for reasons that are about
 * the code rather than about the company. */
export function readCapacityView(
  claims:Awaited<ReturnType<typeof getReconstructionClaims>>,productId:string,ids:string[],
):CapacityView {
  const capacities=new Map<string,{amount:number;claimId:string}>(); const demands:CapacityView['demands']=[];
  const commitments:CapacityView['commitments']=[]; const ownerConstraints:CapacityView['ownerConstraints']=[];
  const economics:CapacityView['economics']=[];
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
  return {capacities,demands,commitments,ownerConstraints,economics};
}

/** Deterministic: a resource whose summed demands exceed its canonical
 * capacity. Returns null when the company is not over-subscribed. */
export function findCapacityConflict(view:CapacityView):
{resource:string;capacity:{amount:number;claimId:string};affected:CapacityView['demands']}|null {
  const conflict=[...view.capacities].find(([resource,capacity])=>
    view.demands.filter(d=>d.resource===resource).reduce((n,d)=>n+d.amount,0)>capacity.amount);
  if (!conflict) return null;
  const [resource,capacity]=conflict;
  return {resource,capacity,affected:view.demands.filter(d=>d.resource===resource)};
}

export async function createDeterministicCapacityJudgment(productId:string,responsibilityIds:string[]):Promise<string|null> {
  const ids=[...new Set(responsibilityIds)]; if (ids.length<2) return null;
  const responsibilities=await query(`SELECT id,title,due_at FROM institutional_responsibilities WHERE product_id=?
    AND id IN (${ids.map(()=>'?').join(',')})`,[productId,...ids]);
  if (responsibilities.rows.length!==ids.length) throw new Error('institutional judgment tenant boundary');
  // THE DEADLINE HAS A SUPPLY NOW. `Demand.deadline` was declared and never
  // filled by anything, so every judgment this function has ever raised listed
  // `deadline unknown` for every responsibility in it — an uncertainty that was
  // structurally guaranteed rather than observed. Where the company has stated
  // a date it is read from the responsibility, which is the only place a date
  // is allowed to come from; where it has not, the uncertainty is real and
  // still reported.
  const statedDue=new Map<string,string>();
  for (const r of responsibilities.rows as unknown as Array<Record<string,unknown>>) {
    if (r.due_at!=null) statedDue.set(String(r.id),String(r.due_at));
  }
  const view=readCapacityView(await getReconstructionClaims(productId),productId,ids);
  const {commitments,ownerConstraints,economics}=view;
  const found=findCapacityConflict(view);
  if (!found) return null;
  const {resource,capacity}=found;
  const affected=found.affected.map(d=>({...d,deadline:d.deadline??statedDue.get(d.responsibilityId)}));
  // One judgment per standing conflict. A scheduled producer sees the same
  // conflict on every tick; re-raising it would spend founder attention to say
  // nothing new. The existing judgment is returned so the caller can tell the
  // conflict is known without creating anything.
  const identity=conflictIdentity(resource,affected.map(d=>d.responsibilityId));
  const standing=(await query('SELECT id FROM strategic_decisions_log WHERE product_id=? AND conflict_identity=?',
    [productId,identity])).rows[0];
  if (standing) return String((standing as Record<string,unknown>).id);
  const relevantCommitments=commitments.filter(c=>c.kind==='hard_external');
  const evidence=[capacity.claimId,...affected.map(d=>d.claimId),...commitments.map(c=>c.claimId),...ownerConstraints.map(c=>c.claimId),...economics.map(e=>e.claimId)]; const id=nanoid();
  const economicStatuses=new Set(economics.map(e=>e.status));
  const economicEffect=economics.length===1&&['known','inferred'].includes(economics[0].status)
    ?{status:economics[0].status==='known'?'observed':'inferred_estimate',value:economics[0].value}
    :{status:economics.length===0?'unknown':economicStatuses.size>1||economicStatuses.has('conflicting')?'conflicting':'unknown',value:null};
  await query(`INSERT INTO strategic_decisions_log
    (id,product_id,decision_title,decision_description,decision_rationale,expected_outcome,decision_category,made_by,status,
     agent_context_json,alternatives_considered_json,key_assumptions_json,responsibility_refs_json,evidence_refs_json,
     constraints_json,uncertainties_json,consequences_json,reversible,expected_economic_effect_json,authority_required_json,
     conflict_identity)
    VALUES (?,?,?,?,?,?,'operations','agent_recommendation','active','{}',?,?,?,?,?,?,?,1,?,?,?)`,[
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
    identity,
  ]);
  return id;
}

/** Production pass. Judgment machinery existed with no writer outside its own
 * tests — an orphan abstraction that paid no rent and left the owner-facing
 * "needs your direction" section permanently empty.
 *
 * The pass reads current institutional state and raises at most what the
 * deterministic comparison finds. It grants nothing, executes nothing, and
 * touches no responsibility state: authority_required stays true on every
 * judgment, and the owner's later direction is still not permission. */
export async function runInstitutionalJudgmentPass(productId:string):Promise<{judgmentId:string|null;raised:boolean}> {
  const active=await query(
    `SELECT id FROM institutional_responsibilities WHERE product_id=? AND disposition='active' ORDER BY id`,[productId]);
  const ids=(active.rows as unknown as Array<Record<string,unknown>>).map(r=>String(r.id));
  if (ids.length<2) return {judgmentId:null,raised:false};
  const before=await query(
    'SELECT COUNT(*) n FROM strategic_decisions_log WHERE product_id=? AND conflict_identity IS NOT NULL',[productId]);
  const judgmentId=await createDeterministicCapacityJudgment(productId,ids);
  const after=await query(
    'SELECT COUNT(*) n FROM strategic_decisions_log WHERE product_id=? AND conflict_identity IS NOT NULL',[productId]);
  const raised=Number((after.rows[0] as Record<string,unknown>).n)>Number((before.rows[0] as Record<string,unknown>).n);
  return {judgmentId,raised};
}
