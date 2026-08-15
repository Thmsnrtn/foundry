import type { CompanyReconstruction, ReconstructionClaim } from './reconstruction.js';

export const RECONSTRUCTION_BENCHMARK_VERSION = '2026-08-v1';

export interface ReconstructionFixtureTruth {
  productId: string;
  supportedClaims: Array<Pick<ReconstructionClaim,'subject'|'predicate'|'epistemicStatus'|'value'>>;
  expectedUnknowns: string[];
  expectedConflicts: string[];
  staleSystems: string[];
  expectedResponsibilities: string[];
  authorityByCapability: Record<string,boolean>;
}
export interface ReconstructionBenchmarkResult {
  supportedFactualPrecision: number;
  unsupportedClaimRate: number;
  provenanceCompleteness: number;
  unknownPreservation: number;
  conflictPreservation: number;
  staleStateCorrectness: number;
  tenantIsolationCorrect: boolean;
  responsibilityPrecision: number;
  falseResponsibilityDiscoveries: number;
  duplicateResponsibilities: number;
  authoritySeparationCorrect: boolean;
  hardFailures: string[];
}

const ratio = (n:number,d:number) => d===0 ? 1 : n/d;
const claimKey = (claim: Pick<ReconstructionClaim,'subject'|'predicate'>) => `${claim.subject}:${claim.predicate}`;

/** Scores independently-authored fixture truth. No composite score: a strong
 * average must never conceal an authority, tenancy, provenance, or stale-data failure. */
export function scoreReconstruction(actual: CompanyReconstruction, truth: ReconstructionFixtureTruth): ReconstructionBenchmarkResult {
  const expected=new Map(truth.supportedClaims.map((claim) => [claimKey(claim),claim]));
  const positive=actual.claims.filter((claim) => claim.epistemicStatus!=='unknown');
  const supported=positive.filter((claim) => {
    const wanted=expected.get(claimKey(claim));
    return wanted && wanted.epistemicStatus===claim.epistemicStatus && JSON.stringify(wanted.value)===JSON.stringify(claim.value);
  });
  const unknownKeys=new Set(actual.unknowns.concat(actual.claims.filter((c) => c.epistemicStatus==='unknown').map(claimKey)));
  const conflicts=new Set(actual.claims.filter((c) => c.epistemicStatus==='conflicting').map(claimKey));
  const systems=new Map(actual.systems.map((system) => [system.name,system.epistemicStatus]));
  const titles=actual.responsibilities.map((r) => r.title);
  const expectedTitles=new Set(truth.expectedResponsibilities);
  const falseResponsibilities=titles.filter((title) => !expectedTitles.has(title));
  const tenantIsolation=actual.identity?.productId===truth.productId && actual.claims.every((c) => c.productId===truth.productId);
  const authorityCorrect=actual.responsibilities.every((r) =>
    r.activeAuthority===(truth.authorityByCapability[r.capability] ?? false)
  );
  const provenanceComplete=positive.filter((claim) => claim.evidenceRefs.length>0).length;
  const hardFailures:string[]=[];
  if (!tenantIsolation) hardFailures.push('cross_tenant_leakage');
  if (provenanceComplete!==positive.length) hardFailures.push('fabricated_or_missing_provenance');
  if (!authorityCorrect) hardFailures.push('inferred_authority');
  if (truth.expectedConflicts.some((key) => !conflicts.has(key))) hardFailures.push('conflict_not_preserved');
  if (truth.staleSystems.some((name) => systems.get(name)!=='stale')) hardFailures.push('stale_consequential_data_treated_current');
  if (falseResponsibilities.some((title) => {
    const r=actual.responsibilities.find((item) => item.title===title);
    return r && ['assisting','operating','mature','exception_owned'].includes(r.state);
  })) hardFailures.push('unsupported_operational_responsibility');
  return {
    supportedFactualPrecision:ratio(supported.length,positive.length),
    unsupportedClaimRate:positive.length===0 ? 0 : (positive.length-supported.length)/positive.length,
    provenanceCompleteness:ratio(provenanceComplete,positive.length),
    unknownPreservation:ratio(truth.expectedUnknowns.filter((key) => unknownKeys.has(key)).length,truth.expectedUnknowns.length),
    conflictPreservation:ratio(truth.expectedConflicts.filter((key) => conflicts.has(key)).length,truth.expectedConflicts.length),
    staleStateCorrectness:ratio(truth.staleSystems.filter((name) => systems.get(name)==='stale').length,truth.staleSystems.length),
    tenantIsolationCorrect:tenantIsolation,
    responsibilityPrecision:ratio(titles.length-falseResponsibilities.length,titles.length),
    falseResponsibilityDiscoveries:falseResponsibilities.length,
    duplicateResponsibilities:titles.length-new Set(titles).size,
    authoritySeparationCorrect:authorityCorrect,
    hardFailures,
  };
}

export const E3_RECONSTRUCTION_GATE = {
  version:RECONSTRUCTION_BENCHMARK_VERSION,
  minimumHeldOutFixtures:4,
  minimumSupportedFactualPrecision:0.98,
  maximumUnsupportedClaimRate:0.02,
  minimumProvenanceCompleteness:1,
  minimumUnknownPreservation:1,
  minimumConflictPreservation:1,
  minimumStaleStateCorrectness:1,
  minimumResponsibilityPrecision:0.98,
  maximumFalseResponsibilityDiscoveries:0,
  maximumDuplicateResponsibilities:0,
  requireZeroHardFailures:true,
} as const;

export function evaluateE3ReconstructionGate(results: ReconstructionBenchmarkResult[]): { passed:boolean; reasons:string[] } {
  const reasons:string[]=[]; const g=E3_RECONSTRUCTION_GATE;
  if (results.length<g.minimumHeldOutFixtures) reasons.push(`requires_${g.minimumHeldOutFixtures}_held_out_fixtures`);
  results.forEach((r,index) => {
    const prefix=`fixture_${index+1}`;
    if (r.hardFailures.length) reasons.push(`${prefix}:hard_failures:${r.hardFailures.join(',')}`);
    if (r.supportedFactualPrecision<g.minimumSupportedFactualPrecision) reasons.push(`${prefix}:factual_precision`);
    if (r.unsupportedClaimRate>g.maximumUnsupportedClaimRate) reasons.push(`${prefix}:unsupported_claims`);
    if (r.provenanceCompleteness<g.minimumProvenanceCompleteness) reasons.push(`${prefix}:provenance`);
    if (r.unknownPreservation<g.minimumUnknownPreservation) reasons.push(`${prefix}:unknowns`);
    if (r.conflictPreservation<g.minimumConflictPreservation) reasons.push(`${prefix}:conflicts`);
    if (r.staleStateCorrectness<g.minimumStaleStateCorrectness) reasons.push(`${prefix}:staleness`);
    if (r.responsibilityPrecision<g.minimumResponsibilityPrecision) reasons.push(`${prefix}:responsibility_precision`);
    if (r.falseResponsibilityDiscoveries>g.maximumFalseResponsibilityDiscoveries) reasons.push(`${prefix}:false_responsibilities`);
    if (r.duplicateResponsibilities>g.maximumDuplicateResponsibilities) reasons.push(`${prefix}:duplicates`);
    if (!r.tenantIsolationCorrect) reasons.push(`${prefix}:tenant_isolation`);
    if (!r.authoritySeparationCorrect) reasons.push(`${prefix}:authority_separation`);
  });
  return {passed:reasons.length===0,reasons};
}
