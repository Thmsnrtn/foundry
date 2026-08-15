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
  return {responsibility,facts,requiredFacts,missingCriticalFacts:[...missingCriticalFacts],unresolvedFacts:[...unresolvedFacts],
    authorityRequired:responsibility.authorityRef===null};
}

export async function earnResponsibilityUnderstanding(productId:string,responsibilityId:string,now:Date=new Date()):Promise<Responsibility> {
  const understanding=await projectResponsibilityUnderstanding(productId,responsibilityId,now);
  if (understanding.responsibility.state!=='visible' || understanding.missingCriticalFacts.length || understanding.unresolvedFacts.length) {
    throw new Error('responsibility understanding insufficient');
  }
  const evidence=understanding.facts.find((fact)=>fact.predicate==='purpose')!;
  return transitionResponsibility({productId,responsibilityId,from:'visible',to:'understood',
    evidenceRef:`reconstruction_claim:${evidence.claimId}`,reason:'Critical operating facts are current and canonically grounded',
    actorRef:'institution:responsibility_understanding_verifier'});
}
