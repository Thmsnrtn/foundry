import type { ResponsibilityUnderstanding,UnderstandingFact } from './responsibility-understanding.js';

export const RESPONSIBILITY_UNDERSTANDING_BENCHMARK_VERSION='2026-08-v1';
export interface UnderstandingTruth {
  productId:string; responsibilityId:string; requiredFacts:UnderstandingFact[];
  expectedValues:Partial<Record<UnderstandingFact,unknown>>; expectedUnresolved:UnderstandingFact[];
  shouldTransition:boolean;
}
export interface UnderstandingBenchmarkResult {
  criticalFactCoverage:number; unsupportedUnderstandingRate:number; unknownPreservation:number;
  conflictPreservation:number; staleStateCorrectness:number; provenanceCompleteness:number;
  dependencyCorrectness:number; constraintCorrectness:number; riskCorrectness:number;
  authorityRequirementCorrect:boolean; tenantIsolationCorrect:boolean; transitionCorrect:boolean; hardFailures:string[];
}
const ratio=(n:number,d:number)=>d===0?1:n/d;

export function scoreResponsibilityUnderstanding(actual:ResponsibilityUnderstanding,truth:UnderstandingTruth):UnderstandingBenchmarkResult {
  const facts=new Map(actual.facts.map((fact)=>[fact.predicate,fact]));
  const supported=truth.requiredFacts.filter((predicate)=>{
    const fact=facts.get(predicate); const expected=truth.expectedValues[predicate];
    return fact && !['unknown','conflicting','stale'].includes(fact.epistemicStatus)
      && (expected===undefined || JSON.stringify(fact.value)===JSON.stringify(expected));
  });
  const produced=actual.facts.filter((fact)=>truth.requiredFacts.includes(fact.predicate));
  const unsupported=produced.filter((fact)=>{
    const expected=truth.expectedValues[fact.predicate];
    return expected!==undefined && JSON.stringify(expected)!==JSON.stringify(fact.value);
  });
  const unresolved=new Set(actual.unresolvedFacts);
  const preserved=truth.expectedUnresolved.filter((fact)=>unresolved.has(fact));
  const tenantCorrect=actual.responsibility.productId===truth.productId && actual.responsibility.id===truth.responsibilityId;
  const transitionCorrect=truth.shouldTransition
    ? actual.responsibility.state==='understood'
    : actual.responsibility.state==='visible';
  const provenance=produced.filter((fact)=>fact.evidenceRefs.length>0).length;
  const hardFailures:string[]=[];
  if (actual.responsibility.state==='understood' && (actual.missingCriticalFacts.length || actual.unresolvedFacts.length)) hardFailures.push('understood_with_critical_gap');
  if (!tenantCorrect) hardFailures.push('cross_tenant_knowledge');
  if (provenance!==produced.length) hardFailures.push('fabricated_or_missing_provenance');
  if (truth.expectedUnresolved.some((fact)=>!unresolved.has(fact))) hardFailures.push('epistemic_state_collapsed');
  if (actual.responsibility.authorityRef!==null) hardFailures.push('authority_inferred_from_understanding');
  return {
    criticalFactCoverage:ratio(supported.length,truth.requiredFacts.length),
    unsupportedUnderstandingRate:produced.length===0?0:unsupported.length/produced.length,
    unknownPreservation:ratio(preserved.length,truth.expectedUnresolved.length),
    conflictPreservation:ratio(truth.expectedUnresolved.filter((fact)=>facts.get(fact)?.epistemicStatus==='conflicting').length,
      truth.expectedUnresolved.filter((fact)=>facts.get(fact)?.epistemicStatus==='conflicting').length),
    staleStateCorrectness:ratio(truth.expectedUnresolved.filter((fact)=>facts.get(fact)?.epistemicStatus==='stale').length,
      truth.expectedUnresolved.filter((fact)=>facts.get(fact)?.epistemicStatus==='stale').length),
    provenanceCompleteness:ratio(provenance,produced.length),
    dependencyCorrectness:truth.requiredFacts.includes('dependencies')&&supported.includes('dependencies')?1:truth.requiredFacts.includes('dependencies')?0:1,
    constraintCorrectness:truth.requiredFacts.includes('operating_constraints')&&supported.includes('operating_constraints')?1:truth.requiredFacts.includes('operating_constraints')?0:1,
    riskCorrectness:truth.requiredFacts.includes('risks')&&supported.includes('risks')?1:truth.requiredFacts.includes('risks')?0:1,
    authorityRequirementCorrect:actual.authorityRequired && actual.responsibility.authorityRef===null,
    tenantIsolationCorrect:tenantCorrect,transitionCorrect,hardFailures,
  };
}

export const E3_RESPONSIBILITY_UNDERSTANDING_GATE={version:RESPONSIBILITY_UNDERSTANDING_BENCHMARK_VERSION,
  minimumHeldOutFixtures:4,minimumCriticalFactCoverage:1,maximumUnsupportedUnderstandingRate:0,
  minimumUnknownPreservation:1,minimumProvenanceCompleteness:1,requireTenantIsolation:true,
  requireAuthorityRequirementCorrect:true,requireTransitionCorrect:true,requireZeroHardFailures:true} as const;

export function evaluateE3ResponsibilityUnderstandingGate(results:UnderstandingBenchmarkResult[]):{passed:boolean;reasons:string[]} {
  const reasons:string[]=[]; const gate=E3_RESPONSIBILITY_UNDERSTANDING_GATE;
  if (results.length<gate.minimumHeldOutFixtures) reasons.push(`requires_${gate.minimumHeldOutFixtures}_held_out_fixtures`);
  results.forEach((result,index)=>{
    const p=`fixture_${index+1}`;
    if (result.hardFailures.length) reasons.push(`${p}:hard_failures:${result.hardFailures.join(',')}`);
    if (result.criticalFactCoverage<1) reasons.push(`${p}:critical_facts`);
    if (result.unsupportedUnderstandingRate>0) reasons.push(`${p}:unsupported`);
    if (result.unknownPreservation<1) reasons.push(`${p}:unknowns`);
    if (result.provenanceCompleteness<1) reasons.push(`${p}:provenance`);
    if (!result.tenantIsolationCorrect) reasons.push(`${p}:tenant`);
    if (!result.authorityRequirementCorrect) reasons.push(`${p}:authority`);
    if (!result.transitionCorrect) reasons.push(`${p}:transition`);
  });
  return {passed:reasons.length===0,reasons};
}
