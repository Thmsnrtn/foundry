export const RESPONSIBILITY_SHADOWING_BENCHMARK_VERSION='2026-08-v1';
export type ShadowClassification='matched'|'deviated'|'unresolved';
export interface ShadowTruth {productId:string;expected:Record<string,ShadowClassification>}
export interface ShadowActual {
  productId:string; observations:Array<{ref:string;classification:ShadowClassification;provenanceComplete:boolean}>;
  duplicateObservations:number; responsibilityState:string; authorityRef:string|null;
  createdActions:number;createdExecutions:number;
}
export interface ShadowBenchmarkResult {
  relevantEventRecognition:number;materialEventMissRate:number;falseEventAttribution:number;
  exceptionDetection:number;classificationCorrectness:number;unsupportedInterpretationRate:number;
  uncertaintyPreservation:number;provenanceCompleteness:number;tenantIsolationCorrect:boolean;
  replayConvergence:number;authoritySeparationCorrect:boolean;hardFailures:string[];
}
const ratio=(n:number,d:number)=>d===0?1:n/d;
export function scoreResponsibilityShadowing(actual:ShadowActual,truth:ShadowTruth):ShadowBenchmarkResult {
  const byRef=new Map(actual.observations.map((observation)=>[observation.ref,observation]));
  const expectedRefs=Object.keys(truth.expected);
  const recognized=expectedRefs.filter((ref)=>byRef.has(ref));
  const correct=expectedRefs.filter((ref)=>byRef.get(ref)?.classification===truth.expected[ref]);
  const falseRefs=actual.observations.filter((observation)=>!(observation.ref in truth.expected));
  const expectedExceptions=expectedRefs.filter((ref)=>truth.expected[ref]!=='matched');
  const detectedExceptions=expectedExceptions.filter((ref)=>byRef.get(ref)?.classification===truth.expected[ref]);
  const uncertaintyExpected=expectedRefs.filter((ref)=>truth.expected[ref]==='unresolved');
  const uncertaintyPreserved=uncertaintyExpected.filter((ref)=>byRef.get(ref)?.classification==='unresolved');
  const provenance=actual.observations.filter((observation)=>observation.provenanceComplete).length;
  const tenantCorrect=actual.productId===truth.productId;
  const authoritySeparated=actual.authorityRef===null && actual.createdActions===0 && actual.createdExecutions===0;
  const hardFailures:string[]=[];
  if (!tenantCorrect) hardFailures.push('cross_tenant_observation');
  if (provenance!==actual.observations.length) hardFailures.push('fabricated_observation');
  if (uncertaintyPreserved.length!==uncertaintyExpected.length) hardFailures.push('unresolved_collapsed');
  if (!authoritySeparated) hardFailures.push('shadowing_created_authority_or_execution');
  if (actual.responsibilityState!=='shadowing') hardFailures.push('maturity_contract_bypassed');
  return {relevantEventRecognition:ratio(recognized.length,expectedRefs.length),
    materialEventMissRate:expectedRefs.length===0?0:(expectedRefs.length-recognized.length)/expectedRefs.length,
    falseEventAttribution:actual.observations.length===0?0:falseRefs.length/actual.observations.length,
    exceptionDetection:ratio(detectedExceptions.length,expectedExceptions.length),
    classificationCorrectness:ratio(correct.length,expectedRefs.length),
    unsupportedInterpretationRate:actual.observations.length===0?0:falseRefs.length/actual.observations.length,
    uncertaintyPreservation:ratio(uncertaintyPreserved.length,uncertaintyExpected.length),
    provenanceCompleteness:ratio(provenance,actual.observations.length),tenantIsolationCorrect:tenantCorrect,
    replayConvergence:actual.duplicateObservations===0?1:0,authoritySeparationCorrect:authoritySeparated,hardFailures};
}
export const E3_RESPONSIBILITY_SHADOWING_GATE={version:RESPONSIBILITY_SHADOWING_BENCHMARK_VERSION,
  minimumHeldOutFixtures:4,minimumRelevantEventRecognition:1,maximumMaterialEventMissRate:0,
  maximumFalseEventAttribution:0,minimumExceptionDetection:1,minimumClassificationCorrectness:1,
  maximumUnsupportedInterpretationRate:0,minimumUncertaintyPreservation:1,minimumProvenanceCompleteness:1,
  requireTenantIsolation:true,minimumReplayConvergence:1,requireAuthoritySeparation:true,requireZeroHardFailures:true} as const;
export function evaluateE3ResponsibilityShadowingGate(results:ShadowBenchmarkResult[]):{passed:boolean;reasons:string[]} {
  const reasons:string[]=[];
  if (results.length<E3_RESPONSIBILITY_SHADOWING_GATE.minimumHeldOutFixtures) reasons.push('insufficient_fixture_breadth');
  results.forEach((result,index)=>{const p=`fixture_${index+1}`;
    if (result.hardFailures.length) reasons.push(`${p}:hard:${result.hardFailures.join(',')}`);
    if (result.relevantEventRecognition<1||result.materialEventMissRate>0) reasons.push(`${p}:event_recognition`);
    if (result.falseEventAttribution>0||result.unsupportedInterpretationRate>0) reasons.push(`${p}:attribution`);
    if (result.exceptionDetection<1||result.classificationCorrectness<1) reasons.push(`${p}:classification`);
    if (result.uncertaintyPreservation<1) reasons.push(`${p}:uncertainty`);
    if (result.provenanceCompleteness<1) reasons.push(`${p}:provenance`);
    if (!result.tenantIsolationCorrect) reasons.push(`${p}:tenant`);
    if (result.replayConvergence<1) reasons.push(`${p}:replay`);
    if (!result.authoritySeparationCorrect) reasons.push(`${p}:authority`);
  });
  return {passed:reasons.length===0,reasons};
}
