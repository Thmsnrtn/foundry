import { query } from '../../db/client.js';
import { getReconstructionClaims,type EpistemicStatus,type ReconstructionEvidenceRef } from './reconstruction.js';
import { getResponsibility,transitionResponsibility,type Responsibility } from './responsibility.js';

const UNDERSTANDING_FACTS=['purpose','desired_outcome','success_conditions','failure_conditions','operating_constraints',
  'dependencies','systems','current_carrier','commitments','authority_requirements','capability_requirements','risks',
  'failure_modes','stakeholder_obligations','financial_consequence'] as const;
export type UnderstandingFact=typeof UNDERSTANDING_FACTS[number];
const BASE_REQUIREMENTS:UnderstandingFact[]=['purpose','desired_outcome','success_conditions','operating_constraints','dependencies','risks'];
const CAPABILITY_REQUIREMENTS:Record<string,UnderstandingFact[]>={
  development:['systems','failure_modes'],
  billing_recovery:['failure_conditions','stakeholder_obligations','financial_consequence'],
  customer_support:[],
  operations:['systems','current_carrier','failure_modes'],
};
export function requiredUnderstandingFacts(capability:string):UnderstandingFact[] {
  return [...BASE_REQUIREMENTS,...(CAPABILITY_REQUIREMENTS[capability]??[])];
}
export interface UnderstandingValue {
  predicate:UnderstandingFact; value:unknown; epistemicStatus:EpistemicStatus;
  evidenceRefs:ReconstructionEvidenceRef[]; claimId:string;
}
export interface ResponsibilityUnderstanding {
  responsibility:Responsibility; facts:UnderstandingValue[]; missingCriticalFacts:UnderstandingFact[];
  unresolvedFacts:UnderstandingFact[]; requiredFacts:UnderstandingFact[]; authorityRequired:boolean;
}

export async function projectResponsibilityUnderstanding(productId:string,responsibilityId:string,now:Date=new Date()):Promise<ResponsibilityUnderstanding> {
  const responsibility=await getResponsibility(productId,responsibilityId);
  if (!responsibility) throw new Error('responsibility understanding refused');
  const subject=`responsibility:${responsibilityId}`;
  const claims=(await getReconstructionClaims(productId,now)).filter((claim)=>claim.subject===subject);
  const facts:UnderstandingValue[]=claims.filter((claim)=>UNDERSTANDING_FACTS.includes(claim.predicate as UnderstandingFact)).map((claim)=>({
    predicate:claim.predicate as UnderstandingFact,value:claim.value,epistemicStatus:claim.epistemicStatus,
    evidenceRefs:claim.evidenceRefs,claimId:claim.id,
  }));
  const current=new Map(facts.map((fact)=>[fact.predicate,fact]));
  const requiredFacts=requiredUnderstandingFacts(responsibility.capability);
  const missingCriticalFacts=requiredFacts.filter((predicate)=>!current.has(predicate));
  const unresolvedFacts=requiredFacts.filter((predicate)=>{
    const fact=current.get(predicate); return fact!=null && ['unknown','conflicting','stale'].includes(fact.epistemicStatus);
  });
  // AUTHORITY IS REQUIRED UNTIL SOMETHING LIVE SAYS OTHERWISE.
  //
  // This was `responsibility.authorityRef===null`, and that column is not
  // cleared when a founder withdraws permission — the consent it names gets a
  // `revoked_at` and the pointer stays, because the transition ledger keeps the
  // history and every execution path re-reads `revoked_at IS NULL` at the
  // moment it acts. Correct behaviour, wrong reading here: the projection said
  // authority was NO LONGER REQUIRED for a responsibility whose permission had
  // just been taken away, which is the answer exactly inverted on the one
  // question the founder had just acted on.
  //
  // It asks the ledger the same question the execution paths ask, so a
  // withdrawal reads as a withdrawal everywhere.
  // Deliberately NOT `liveActGrant()`: that fragment compares against the
  // database's own clock, and this projection takes the caller's, which the
  // benchmarks use to reconstruct a moment. Same three conditions, one of them
  // against a supplied time. If authority grows a fourth axis this is the copy
  // that has to be updated by hand — which is exactly why the other five
  // stopped being copies.
  const liveGrant=await query(
    `SELECT 1 FROM autonomy_consents a
      WHERE a.responsibility_id=? AND a.product_id=? AND a.capability=?
        AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime(?)
      LIMIT 1`,
    [responsibilityId,productId,responsibility.capability,now.toISOString()]);
  return {responsibility,facts,requiredFacts,missingCriticalFacts:[...missingCriticalFacts],unresolvedFacts:[...unresolvedFacts],
    authorityRequired:liveGrant.rows.length===0};
}

export async function earnResponsibilityUnderstanding(productId:string,responsibilityId:string,now:Date=new Date()):Promise<Responsibility> {
  const understanding=await projectResponsibilityUnderstanding(productId,responsibilityId,now);
  if (understanding.responsibility.state!=='visible' || understanding.missingCriticalFacts.length || understanding.unresolvedFacts.length) {
    throw new Error('responsibility understanding insufficient');
  }
  // `facts` is the full appended history, oldest first, so a fact the founder
  // later revised appears twice. The transition must cite the claim that
  // establishes understanding NOW — taking the first would ground the rung in
  // a superseded statement.
  const purposeClaims=understanding.facts.filter((fact)=>fact.predicate==='purpose');
  const evidence=purposeClaims[purposeClaims.length-1];
  return transitionResponsibility({productId,responsibilityId,from:'visible',to:'understood',
    evidenceRef:`reconstruction_claim:${evidence.claimId}`,reason:'Critical operating facts are current and canonically grounded',
    actorRef:'institution:responsibility_understanding_verifier'});
}
