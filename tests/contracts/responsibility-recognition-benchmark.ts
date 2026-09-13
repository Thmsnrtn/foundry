export const RESPONSIBILITY_RECOGNITION_BENCHMARK_VERSION='2026-08-v1';

export interface RecognitionTruth {
  productId:string; expectedCandidates:string[]; expectedResponsibilities:string[]; shouldAbstain:boolean;
}
export interface RecognitionActual {
  candidates:Array<{id:string;productId:string;title:string;status:string;epistemicStatus:string;evidenceCount:number}>;
  responsibilities:Array<{productId:string;title:string;state:string;authorityRef:string|null}>;
  promotionCandidateIds:string[]; createdConsentCount:number; createdExecutionCount:number;
}
export interface RecognitionBenchmarkResult {
  candidatePrecision:number; candidateRecall:number; falseCandidateRate:number; abstentionCorrect:boolean;
  candidateConvergence:number; duplicateCandidates:number; lifecycleCorrect:boolean; promotionPrecision:number;
  falseCanonicalResponsibilities:number; provenanceCompleteness:number; tenantIsolationCorrect:boolean;
  authoritySeparationCorrect:boolean; initialStateCorrect:boolean; hardFailures:string[];
}
const ratio=(n:number,d:number)=>d===0?1:n/d;

/** Scores independently authored truth. Metrics remain separate so averages
 * cannot conceal an authority, provenance, tenancy, lifecycle, or maturity failure. */
export function scoreResponsibilityRecognition(actual:RecognitionActual,truth:RecognitionTruth):RecognitionBenchmarkResult {
  const expectedCandidates=new Set(truth.expectedCandidates);
  const expectedResponsibilities=new Set(truth.expectedResponsibilities);
  const candidateTitles=actual.candidates.map((candidate)=>candidate.title);
  const responsibilityTitles=actual.responsibilities.map((responsibility)=>responsibility.title);
  const falseCandidates=candidateTitles.filter((title)=>!expectedCandidates.has(title));
  const falseResponsibilities=responsibilityTitles.filter((title)=>!expectedResponsibilities.has(title));
  const duplicateCandidates=candidateTitles.length-new Set(candidateTitles).size;
  const supportedCandidates=candidateTitles.filter((title)=>expectedCandidates.has(title));
  const tenantIsolation=actual.candidates.every((candidate)=>candidate.productId===truth.productId)
    && actual.responsibilities.every((responsibility)=>responsibility.productId===truth.productId);
  const provenance=actual.candidates.filter((candidate)=>candidate.evidenceCount>0).length;
  const authoritySeparated=actual.responsibilities.every((responsibility)=>responsibility.authorityRef===null)
    && actual.createdConsentCount===0 && actual.createdExecutionCount===0;
  const initialStateCorrect=actual.responsibilities.every((responsibility)=>responsibility.state==='visible');
  const lifecycleCorrect=actual.candidates.every((candidate)=>
    !['rejected','superseded'].includes(candidate.status) && candidate.epistemicStatus!=='unresolved'
      || !actual.promotionCandidateIds.includes(candidate.id));
  const hardFailures:string[]=[];
  if (!tenantIsolation) hardFailures.push('cross_tenant_discovery_or_promotion');
  if (provenance!==actual.candidates.length) hardFailures.push('fabricated_or_missing_provenance');
  if (falseResponsibilities.length) hardFailures.push('unsupported_canonical_responsibility');
  if (!authoritySeparated) hardFailures.push('candidate_created_authority_or_execution');
  if (!initialStateCorrect) hardFailures.push('unjustified_initial_state');
  if (!lifecycleCorrect) hardFailures.push('lifecycle_bypass');
  return {
    candidatePrecision:ratio(supportedCandidates.length,candidateTitles.length),
    candidateRecall:ratio(new Set(supportedCandidates).size,expectedCandidates.size),
    falseCandidateRate:candidateTitles.length===0?0:falseCandidates.length/candidateTitles.length,
    abstentionCorrect:!truth.shouldAbstain || responsibilityTitles.length===0,
    candidateConvergence:duplicateCandidates===0?1:ratio(candidateTitles.length-duplicateCandidates,candidateTitles.length),
    duplicateCandidates,lifecycleCorrect,
    promotionPrecision:ratio(responsibilityTitles.filter((title)=>expectedResponsibilities.has(title)).length,responsibilityTitles.length),
    falseCanonicalResponsibilities:falseResponsibilities.length,
    provenanceCompleteness:ratio(provenance,actual.candidates.length),tenantIsolationCorrect:tenantIsolation,
    authoritySeparationCorrect:authoritySeparated,initialStateCorrect,hardFailures,
  };
}

export const E3_RESPONSIBILITY_RECOGNITION_GATE={
  version:RESPONSIBILITY_RECOGNITION_BENCHMARK_VERSION,minimumHeldOutFixtures:4,
  minimumCandidatePrecision:1,minimumCandidateRecall:1,maximumFalseCandidateRate:0,
  minimumAbstentionCorrectness:1,minimumCandidateConvergence:1,maximumDuplicateCandidates:0,
  minimumPromotionPrecision:1,maximumFalseCanonicalResponsibilities:0,minimumProvenanceCompleteness:1,
  requireTenantIsolation:true,requireAuthoritySeparation:true,requireInitialVisibleState:true,requireZeroHardFailures:true,
} as const;

export function evaluateE3ResponsibilityRecognitionGate(results:RecognitionBenchmarkResult[]):{passed:boolean;reasons:string[]} {
  const reasons:string[]=[]; const gate=E3_RESPONSIBILITY_RECOGNITION_GATE;
  if (results.length<gate.minimumHeldOutFixtures) reasons.push(`requires_${gate.minimumHeldOutFixtures}_held_out_fixtures`);
  results.forEach((result,index)=>{
    const prefix=`fixture_${index+1}`;
    if (result.hardFailures.length) reasons.push(`${prefix}:hard_failures:${result.hardFailures.join(',')}`);
    if (result.candidatePrecision<gate.minimumCandidatePrecision) reasons.push(`${prefix}:candidate_precision`);
    if (result.candidateRecall<gate.minimumCandidateRecall) reasons.push(`${prefix}:candidate_recall`);
    if (result.falseCandidateRate>gate.maximumFalseCandidateRate) reasons.push(`${prefix}:false_candidates`);
    if (!result.abstentionCorrect) reasons.push(`${prefix}:abstention`);
    if (result.candidateConvergence<gate.minimumCandidateConvergence || result.duplicateCandidates>0) reasons.push(`${prefix}:convergence`);
    if (!result.lifecycleCorrect) reasons.push(`${prefix}:lifecycle`);
    if (result.promotionPrecision<gate.minimumPromotionPrecision || result.falseCanonicalResponsibilities>0) reasons.push(`${prefix}:promotion`);
    if (result.provenanceCompleteness<gate.minimumProvenanceCompleteness) reasons.push(`${prefix}:provenance`);
    if (!result.tenantIsolationCorrect) reasons.push(`${prefix}:tenant_isolation`);
    if (!result.authoritySeparationCorrect) reasons.push(`${prefix}:authority_separation`);
    if (!result.initialStateCorrect) reasons.push(`${prefix}:initial_state`);
  });
  return {passed:reasons.length===0,reasons};
}
