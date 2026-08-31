// =============================================================================
// FOUNDRY — Production reachability benchmark `production-reachability-v1`
//
// The question this scores is the one that matters now: **can a normal new
// company actually enter the institutional ladder?** Every other benchmark
// measures a step in isolation. This measures the path — observed evidence to a
// recognised responsibility to sufficient grounding to Understood — including
// the part where Foundry has to ask the founder because nothing it can see
// answers the question.
//
// Thresholds are fixed here, before any behaviour was tuned against them, and
// the metrics stay separate so an average can never conceal a tenancy,
// provenance, authority, or invention failure.
//
// What a pass does NOT mean: this is a synthetic corpus. It proves the path is
// reachable and that its refusals hold. It is not production proof, and no
// E4/E5 claim may be derived from it.
// =============================================================================

export const PRODUCTION_REACHABILITY_BENCHMARK_VERSION = 'production-reachability-v1';

export interface ReachabilityClaim {
  productId: string; subject: string; predicate: string; epistemicStatus: string;
  evidenceRefs: Array<{ kind: string; id: string }>; derivationMethod: string;
}
export interface ReachabilityQuestion {
  productId: string; responsibilityId: string; predicate: string; status: string;
}
export interface ReachabilityObservation {
  productId: string;
  responsibilities: Array<{
    id: string; productId: string; title: string; state: string;
    authorityRef: string | null; discoveryEvidenceRef: string | null;
  }>;
  questions: ReachabilityQuestion[];
  claims: ReachabilityClaim[];
  /** Facts answered by an authenticated founder, as `responsibilityId:predicate`. */
  answered: string[];
  consentCount: number;
  executionCount: number;
}
export interface ReachabilityTruth {
  productId: string;
  expectedResponsibilities: string[];
  /** responsibilityId → the facts the institution requires for it. */
  requiredFacts: Record<string, string[]>;
  /** responsibilityId → the furthest rung this company's evidence justifies. */
  expectedState: Record<string, string>;
  /** Facts that must remain recorded as a conflict, as `responsibilityId:predicate`. */
  expectedConflicts: string[];
  /** Facts the founder skipped. Silence must leave them unknown. */
  deferred: string[];
}

export interface ReachabilityResult {
  groundedResponsibilityPrecision: number;
  unsupportedResponsibilityRate: number;
  questionRelevance: number;
  unnecessaryQuestionRate: number;
  claimPrecision: number;
  provenanceCompleteness: number;
  tenantIsolationCorrect: boolean;
  unknownPreservation: number;
  conflictPreservation: number;
  authoritySeparationCorrect: boolean;
  questionDeduplication: number;
  /** Metrics with no executable case in this fixture. A dimension nothing
   * exercised must never score a vacuous 1. */
  exercised: Record<string, number>;
  hardFailures: string[];
}

const FOUNDER_DERIVATION = 'authenticated founder assertion';
const RUNGS = ['unknown', 'visible', 'understood', 'shadowing', 'assisting', 'operating', 'mature', 'exception_owned'];
const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);

export function scoreProductionReachability(
  actual: ReachabilityObservation, truth: ReachabilityTruth,
): ReachabilityResult {
  const expected = new Set(truth.expectedResponsibilities);
  const answered = new Set(actual.answered);
  const deferred = new Set(truth.deferred);

  const unsupported = actual.responsibilities.filter((r) => !expected.has(r.title));
  const tenantRows = [
    ...actual.responsibilities.map((r) => r.productId),
    ...actual.questions.map((q) => q.productId),
    ...actual.claims.map((c) => c.productId),
  ];
  const tenantIsolation = tenantRows.every((id) => id === truth.productId);

  // A question is relevant when it is about a fact this responsibility actually
  // requires. Curiosity is not a reason to spend a founder's attention.
  const relevantQuestions = actual.questions.filter((q) =>
    (truth.requiredFacts[q.responsibilityId] ?? []).includes(q.predicate));

  // A question is unnecessary when the fact was already grounded by evidence
  // Foundry could see for itself — asking for what it already has.
  const groundedWithoutFounder = new Set(actual.claims
    .filter((c) => c.derivationMethod !== FOUNDER_DERIVATION
      && !['unknown', 'stale', 'conflicting'].includes(c.epistemicStatus))
    .map((c) => `${c.subject}:${c.predicate}`));
  const unnecessaryQuestions = actual.questions.filter((q) =>
    groundedWithoutFounder.has(`responsibility:${q.responsibilityId}:${q.predicate}`));

  // Every founder-derived claim must trace to a question the founder answered.
  const founderClaims = actual.claims.filter((c) => c.derivationMethod === FOUNDER_DERIVATION);
  const tracedClaims = founderClaims.filter((c) =>
    answered.has(`${c.subject.replace(/^responsibility:/, '')}:${c.predicate}`));

  const groundable = actual.claims.filter((c) => c.epistemicStatus !== 'unknown');
  const provenanced = groundable.filter((c) => c.evidenceRefs.length > 0);

  // Silence is not evidence: a skipped question must leave the fact unclaimed.
  const deferredWithClaim = [...deferred].filter((key) => {
    const [responsibilityId, predicate] = key.split(':');
    return actual.claims.some((c) => c.subject === `responsibility:${responsibilityId}` && c.predicate === predicate);
  });

  const conflictsHeld = truth.expectedConflicts.filter((key) => {
    const [responsibilityId, predicate] = key.split(':');
    const matching = actual.claims.filter((c) =>
      c.subject === `responsibility:${responsibilityId}` && c.predicate === predicate);
    return matching.some((c) => c.epistemicStatus === 'conflicting');
  });

  const questionKeys = actual.questions.map((q) => `${q.responsibilityId}:${q.predicate}`);
  const duplicateQuestions = questionKeys.length - new Set(questionKeys).size;

  const authoritySeparated = actual.consentCount === 0 && actual.executionCount === 0
    && actual.responsibilities.every((r) => r.authorityRef === null);

  const overshot = actual.responsibilities.filter((r) =>
    RUNGS.indexOf(r.state) > RUNGS.indexOf(truth.expectedState[r.id] ?? 'visible'));

  const hardFailures: string[] = [];
  if (groundable.some((c) => c.evidenceRefs.length === 0)) hardFailures.push('invented_evidence');
  if (!tenantIsolation) hardFailures.push('cross_tenant_claim');
  if (!authoritySeparated) hardFailures.push('founder_answer_created_authority');
  if (unsupported.length) hardFailures.push('unsupported_responsibility');
  if (overshot.length) hardFailures.push('hidden_maturity_jump');
  if (tracedClaims.length !== founderClaims.length) hardFailures.push('fabricated_company_fact');
  if (deferredWithClaim.length) hardFailures.push('silence_treated_as_evidence');

  return {
    groundedResponsibilityPrecision: ratio(
      actual.responsibilities.filter((r) => expected.has(r.title)).length, actual.responsibilities.length),
    unsupportedResponsibilityRate: actual.responsibilities.length === 0
      ? 0 : unsupported.length / actual.responsibilities.length,
    questionRelevance: ratio(relevantQuestions.length, actual.questions.length),
    unnecessaryQuestionRate: actual.questions.length === 0
      ? 0 : unnecessaryQuestions.length / actual.questions.length,
    claimPrecision: ratio(tracedClaims.length, founderClaims.length),
    provenanceCompleteness: ratio(provenanced.length, groundable.length),
    tenantIsolationCorrect: tenantIsolation,
    unknownPreservation: ratio(deferred.size - deferredWithClaim.length, deferred.size),
    conflictPreservation: ratio(conflictsHeld.length, truth.expectedConflicts.length),
    authoritySeparationCorrect: authoritySeparated,
    questionDeduplication: questionKeys.length === 0
      ? 1 : (questionKeys.length - duplicateQuestions) / questionKeys.length,
    exercised: {
      groundedResponsibilityPrecision: actual.responsibilities.length,
      unsupportedResponsibilityRate: actual.responsibilities.length,
      questionRelevance: actual.questions.length,
      unnecessaryQuestionRate: actual.questions.length,
      claimPrecision: founderClaims.length,
      provenanceCompleteness: groundable.length,
      unknownPreservation: deferred.size,
      conflictPreservation: truth.expectedConflicts.length,
      questionDeduplication: questionKeys.length,
    },
    hardFailures,
  };
}

/** Fixed before tuning. Every rate is absolute: a company either reaches the
 * ladder honestly or it does not, and one fabricated fact is not offset by
 * nine correct ones. */
export const PRODUCTION_REACHABILITY_GATE = {
  version: PRODUCTION_REACHABILITY_BENCHMARK_VERSION,
  minimumFixtures: 4,
  minimumGroundedResponsibilityPrecision: 1,
  maximumUnsupportedResponsibilityRate: 0,
  minimumQuestionRelevance: 1,
  maximumUnnecessaryQuestionRate: 0,
  minimumClaimPrecision: 1,
  minimumProvenanceCompleteness: 1,
  minimumUnknownPreservation: 1,
  minimumConflictPreservation: 1,
  minimumQuestionDeduplication: 1,
  requireTenantIsolation: true,
  requireAuthoritySeparation: true,
  requireZeroHardFailures: true,
  /** Dimensions that must be exercised somewhere in the corpus. A gate that can
   * pass without ever testing a dimension is not a gate. */
  mustExercise: [
    'groundedResponsibilityPrecision', 'questionRelevance', 'claimPrecision',
    'provenanceCompleteness', 'unknownPreservation', 'conflictPreservation',
    'questionDeduplication',
  ],
} as const;

export function evaluateProductionReachabilityGate(
  results: ReachabilityResult[],
): { passed: boolean; reasons: string[] } {
  const gate = PRODUCTION_REACHABILITY_GATE;
  const reasons: string[] = [];
  if (results.length < gate.minimumFixtures) reasons.push(`requires_${gate.minimumFixtures}_fixtures`);

  results.forEach((result, index) => {
    const at = `fixture_${index + 1}`;
    if (result.hardFailures.length) reasons.push(`${at}:hard_failures:${result.hardFailures.join(',')}`);
    if (result.groundedResponsibilityPrecision < gate.minimumGroundedResponsibilityPrecision) reasons.push(`${at}:grounded_responsibility_precision`);
    if (result.unsupportedResponsibilityRate > gate.maximumUnsupportedResponsibilityRate) reasons.push(`${at}:unsupported_responsibilities`);
    if (result.questionRelevance < gate.minimumQuestionRelevance) reasons.push(`${at}:question_relevance`);
    if (result.unnecessaryQuestionRate > gate.maximumUnnecessaryQuestionRate) reasons.push(`${at}:unnecessary_questions`);
    if (result.claimPrecision < gate.minimumClaimPrecision) reasons.push(`${at}:claim_precision`);
    if (result.provenanceCompleteness < gate.minimumProvenanceCompleteness) reasons.push(`${at}:provenance`);
    if (result.unknownPreservation < gate.minimumUnknownPreservation) reasons.push(`${at}:unknown_preservation`);
    if (result.conflictPreservation < gate.minimumConflictPreservation) reasons.push(`${at}:conflict_preservation`);
    if (result.questionDeduplication < gate.minimumQuestionDeduplication) reasons.push(`${at}:question_deduplication`);
    if (!result.tenantIsolationCorrect) reasons.push(`${at}:tenant_isolation`);
    if (!result.authoritySeparationCorrect) reasons.push(`${at}:authority_separation`);
  });

  // Coverage integrity across the corpus, not per fixture: one company may
  // legitimately have no conflict, but the corpus may not.
  for (const dimension of gate.mustExercise) {
    const total = results.reduce((n, r) => n + (r.exercised[dimension] ?? 0), 0);
    if (total === 0) reasons.push(`${dimension}_untested`);
  }
  return { passed: reasons.length === 0, reasons };
}
