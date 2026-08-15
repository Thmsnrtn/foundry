import { nanoid } from 'nanoid';
import { batch, query } from '../../db/client.js';
import { getReconstructionClaims } from './reconstruction.js';

export type CandidateEvidenceRef={kind:'signal_event'|'reconstruction_claim';id:string};
export interface ResponsibilityCandidate {
  id:string; productId:string; convergenceKey:string; proposedResponsibility:string;
  evidenceRefs:CandidateEvidenceRef[]; epistemicStatus:'known'|'inferred'|'unresolved';
  confidence:number|null; capabilityDependency:string|null; authorityRequired:boolean;
  status:'pending'|'rejected'|'superseded'|'promoted';
}

function fromRow(row:Record<string,unknown>):ResponsibilityCandidate {
  return {id:String(row.id),productId:String(row.product_id),convergenceKey:String(row.convergence_key),
    proposedResponsibility:String(row.proposed_responsibility),evidenceRefs:JSON.parse(String(row.evidence_refs_json)),
    epistemicStatus:row.epistemic_status as ResponsibilityCandidate['epistemicStatus'],
    confidence:row.confidence==null?null:Number(row.confidence),
    capabilityDependency:row.capability_dependency==null?null:String(row.capability_dependency),
    authorityRequired:Boolean(row.authority_required),status:row.status as ResponsibilityCandidate['status']};
}

/** Creates only a non-executable candidate. Unique product+meaning convergence
 * makes replay/concurrency return the already-governed candidate. */
export async function proposeResponsibilityCandidate(input:{
  productId:string; convergenceKey:string; proposedResponsibility:string; evidenceRefs:CandidateEvidenceRef[];
  derivationMethod:string; rationale:string; epistemicStatus:'known'|'inferred'|'unresolved'; confidence?:number;
  capabilityDependency?:string; authorityRequired?:boolean; observedAt:Date; validUntil?:Date;
}):Promise<ResponsibilityCandidate> {
  const key=input.convergenceKey.trim().toLowerCase();
  try {
    await query(`INSERT INTO responsibility_candidates
      (id,product_id,convergence_key,proposed_responsibility,evidence_refs_json,derivation_method,rationale,
       epistemic_status,confidence,capability_dependency,authority_required,observed_at,valid_until)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[nanoid(),input.productId,key,input.proposedResponsibility.trim(),
      JSON.stringify(input.evidenceRefs),input.derivationMethod.trim(),input.rationale.trim(),input.epistemicStatus,
      input.confidence??null,input.capabilityDependency?.trim()||null,input.authorityRequired?1:0,
      input.observedAt.toISOString(),input.validUntil?.toISOString()??null]);
  } catch (error) {
    const existing=await query('SELECT * FROM responsibility_candidates WHERE product_id=? AND convergence_key=?',[input.productId,key]);
    if (!existing.rows.length) throw error;
  }
  const result=await query('SELECT * FROM responsibility_candidates WHERE product_id=? AND convergence_key=?',[input.productId,key]);
  return fromRow(result.rows[0] as Record<string,unknown>);
}

export async function promoteResponsibilityCandidate(input:{
  productId:string; candidateId:string; mechanism:'deterministic'|'authenticated_owner'; ownerId?:string;
}):Promise<string> {
  const existing=await query(`SELECT resulting_responsibility_id FROM responsibility_candidate_decisions
    WHERE candidate_id=? AND decision='promoted'`,[input.candidateId]);
  if (existing.rows.length) return String((existing.rows[0] as Record<string,unknown>).resulting_responsibility_id);
  const found=await query('SELECT * FROM responsibility_candidates WHERE id=? AND product_id=?',[input.candidateId,input.productId]);
  if (!found.rows.length) throw new Error('candidate promotion refused');
  const c=found.rows[0] as Record<string,unknown>;
  const refs=JSON.parse(String(c.evidence_refs_json)) as CandidateEvidenceRef[];
  let signal=refs.find((ref)=>ref.kind==='signal_event');
  if (!signal) {
    const claim=await query('SELECT evidence_refs_json FROM reconstruction_claims WHERE id=? AND product_id=?',[refs[0]?.id,input.productId]);
    const underlying=claim.rows.length ? JSON.parse(String((claim.rows[0] as Record<string,unknown>).evidence_refs_json)) as CandidateEvidenceRef[] : [];
    signal=underlying.find((ref)=>ref.kind==='signal_event');
  }
  if (!signal) throw new Error('candidate promotion refused');
  const responsibilityId=`candidate_${input.candidateId}`;
  const actor=input.mechanism==='deterministic'?'institution:deterministic_candidate_grounder':`founder:${input.ownerId??''}`;
  try {
    await batch([
      {sql:`INSERT INTO institutional_responsibilities (id,product_id,title,capability) VALUES (?,?,?,?)`,args:[responsibilityId,input.productId,String(c.proposed_responsibility),String(c.capability_dependency??'general')]},
      {sql:`INSERT INTO responsibility_transitions (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
        VALUES (?,?,'unknown','visible',?,?,?)`,args:[nanoid(),responsibilityId,`signal_event:${signal.id}`,'Candidate explicitly grounded as a visible responsibility',actor]},
      {sql:`INSERT INTO responsibility_candidate_decisions
        (id,candidate_id,product_id,decision,grounding_mechanism,grounding_evidence_json,actor_ref,resulting_responsibility_id,resulting_initial_state)
        VALUES (?,?,?,'promoted',?,?,?,?, 'visible')`,args:[nanoid(),input.candidateId,input.productId,input.mechanism,String(c.evidence_refs_json),actor,responsibilityId]},
    ]);
  } catch (error) {
    const won=await query(`SELECT resulting_responsibility_id FROM responsibility_candidate_decisions WHERE candidate_id=? AND decision='promoted'`,[input.candidateId]);
    if (!won.rows.length) throw error;
    return String((won.rows[0] as Record<string,unknown>).resulting_responsibility_id);
  }
  return responsibilityId;
}

export async function getPendingResponsibilityCandidates(productId:string):Promise<ResponsibilityCandidate[]> {
  const result=await query(`SELECT * FROM responsibility_candidates WHERE product_id=? AND status='pending'
    ORDER BY created_at,id`,[productId]);
  return (result.rows as unknown as Array<Record<string,unknown>>).map(fromRow);
}

export async function decideResponsibilityCandidate(input:{
  productId:string; candidateId:string; decision:'rejected'|'reconsidered'; ownerId:string; reason:string;
}):Promise<void> {
  if (!input.reason.trim()) throw new Error('candidate decision refused');
  const candidate=await query('SELECT evidence_refs_json,status FROM responsibility_candidates WHERE id=? AND product_id=?',
    [input.candidateId,input.productId]);
  if (!candidate.rows.length) throw new Error('candidate decision refused');
  const row=candidate.rows[0] as Record<string,unknown>;
  const allowed=input.decision==='rejected' ? String(row.status)==='pending'
    : ['rejected','superseded'].includes(String(row.status));
  if (!allowed) {
    const replay=await query(`SELECT id FROM responsibility_candidate_decisions
      WHERE candidate_id=? AND decision=? AND actor_ref=? ORDER BY created_at DESC LIMIT 1`,
    [input.candidateId,input.decision,`founder:${input.ownerId}`]);
    if (replay.rows.length) return;
    throw new Error('candidate decision refused');
  }
  try {
    await query(`INSERT INTO responsibility_candidate_decisions
      (id,candidate_id,product_id,decision,grounding_mechanism,grounding_evidence_json,actor_ref)
      VALUES (?,?,?,?, 'authenticated_owner',?,?)`,[nanoid(),input.candidateId,input.productId,input.decision,
      JSON.stringify({candidateEvidence:JSON.parse(String(row.evidence_refs_json)),reason:input.reason.trim()}),`founder:${input.ownerId}`]);
  } catch (error) {
    const won=await query(`SELECT id FROM responsibility_candidate_decisions
      WHERE candidate_id=? AND decision=? AND actor_ref=? ORDER BY created_at DESC LIMIT 1`,
    [input.candidateId,input.decision,`founder:${input.ownerId}`]);
    if (!won.rows.length) throw error;
  }
}

export async function supersedeResponsibilityCandidate(input:{
  productId:string; candidateId:string; replacementCandidateId:string; ownerId:string; reason:string;
}):Promise<void> {
  if (!input.reason.trim()) throw new Error('candidate decision refused');
  const candidate=await query('SELECT evidence_refs_json,status FROM responsibility_candidates WHERE id=? AND product_id=?',
    [input.candidateId,input.productId]);
  if (!candidate.rows.length) throw new Error('candidate decision refused');
  const row=candidate.rows[0] as Record<string,unknown>;
  if (String(row.status)!=='pending') {
    const replay=await query(`SELECT id FROM responsibility_candidate_decisions WHERE candidate_id=?
      AND decision='superseded' AND superseded_by_candidate_id=? AND actor_ref=?`,
    [input.candidateId,input.replacementCandidateId,`founder:${input.ownerId}`]);
    if (replay.rows.length) return;
    throw new Error('candidate decision refused');
  }
  await query(`INSERT INTO responsibility_candidate_decisions
    (id,candidate_id,product_id,decision,grounding_mechanism,grounding_evidence_json,actor_ref,superseded_by_candidate_id)
    VALUES (?,?,?,'superseded','authenticated_owner',?,?,?)`,[nanoid(),input.candidateId,input.productId,
    JSON.stringify({candidateEvidence:JSON.parse(String(row.evidence_refs_json)),reason:input.reason.trim()}),
    `founder:${input.ownerId}`,input.replacementCandidateId]);
}

/** Bounded deterministic interpretation of explicit responsibility claims.
 * Unknown/malformed claims abstain; conflict/staleness remain unresolved and
 * therefore cannot promote. Candidate ownership remains structurally unknown. */
export async function discoverCandidatesFromReconstruction(productId:string,now:Date=new Date()):Promise<ResponsibilityCandidate[]> {
  const claims=await getReconstructionClaims(productId,now);
  const discovered:ResponsibilityCandidate[]=[];
  for (const claim of claims) {
    if (claim.predicate!=='operational_responsibility' || claim.epistemicStatus==='unknown') continue;
    const value=claim.value as {title?:unknown;capability?:unknown;authorityRequired?:unknown}|null;
    if (!value || typeof value.title!=='string' || !value.title.trim()) continue;
    const unresolved=['conflicting','stale'].includes(claim.epistemicStatus);
    const candidateStatus:'known'|'inferred'|'unresolved'=unresolved?'unresolved':
      (claim.epistemicStatus as 'known'|'inferred');
    const semanticKey=`${claim.subject}:operational-responsibility:${typeof value.capability==='string'?value.capability:'general'}`
      .trim().toLowerCase();
    discovered.push(await proposeResponsibilityCandidate({
      productId,convergenceKey:semanticKey,proposedResponsibility:value.title,
      evidenceRefs:[{kind:'reconstruction_claim',id:claim.id}],
      derivationMethod:'bounded operational responsibility claim',
      rationale:`Canonical reconstruction evidence identifies responsibility for ${claim.subject}`,
      epistemicStatus:candidateStatus,
      confidence:claim.epistemicStatus==='inferred'?claim.confidence??undefined:undefined,
      capabilityDependency:typeof value.capability==='string'?value.capability:undefined,
      authorityRequired:value.authorityRequired===true,observedAt:new Date(claim.observedAt),
      validUntil:claim.validUntil?new Date(claim.validUntil):undefined,
    }));
  }
  return discovered;
}
