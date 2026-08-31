// =============================================================================
// FOUNDRY — `support-pilot-readiness-v1`
//
// This answers exactly one question:
//
//   Could we responsibly ATTEMPT a narrow bounded support pilot?
//
// It is NOT an evidence maturity level. A green result means the locally
// verifiable prerequisites are in place — it does not mean a pilot happened, it
// does not mean anything worked for a real founder, and it is not E4. Nothing
// in this file may ever be reported as pilot evidence.
//
// The envelope it certifies is deliberately narrow and must stay narrow: one
// company, one canonical responsibility, one low-consequence capability,
// founder-authored reply content, exact responsibility-bound authority with an
// explicit scope and expiry, immediate revocation, deliberate re-grant,
// governed email execution, stable effect identity, a durable receipt, and a
// business outcome that stays unresolved unless independently evidenced.
// Broader machinery existing is not a reason to widen it.
//
// COVERAGE INTEGRITY: a dimension nothing exercised scores nothing. An
// unexercised dimension is reported as `_unexercised` and fails the gate, so a
// contract cannot go green by being untested — the failure mode this program
// has found repeatedly in one form or another.
// =============================================================================

export const SUPPORT_PILOT_READINESS_VERSION = 'support-pilot-readiness-v1';

/** Every dimension the narrow envelope depends on. Each must be exercised by a
 * real observation, not asserted. */
export const READINESS_DIMENSIONS = [
  'production_facing_intake',
  'responsibility_recognition',
  'founder_evidence',
  'understanding_reachable',
  'independent_shadow_observer',
  'shadow_comparison',
  'authority_grant_exact_scope',
  'authority_expiry',
  'authority_revocation',
  'authority_regrant_new_identity',
  'assisting_admission',
  'inbound_customer_message',
  'grounded_channel_attribution',
  'founder_authored_reply',
  'action_planning',
  'execution_time_revalidation',
  'replay_idempotency',
  'governed_effect',
  'durable_receipt',
  'unresolved_outcome_honesty',
  'founder_control',
  'auditability',
  'tenant_isolation',
  'customer_content_safety',
  'structural_production_reachability',
] as const;
export type ReadinessDimension = typeof READINESS_DIMENSIONS[number];

export interface ReadinessObservation {
  /** Dimensions actually exercised, with whether each held. */
  exercised: Partial<Record<ReadinessDimension, boolean>>;
  /** External proof debt that remains regardless of a green result. */
  outstandingExternalProof: string[];
}

export interface ReadinessResult {
  version: string;
  ready: boolean;
  /** Dimensions that were exercised and failed. */
  failed: ReadinessDimension[];
  /** Dimensions nothing exercised — never scored as passing. */
  unexercised: ReadinessDimension[];
  outstandingExternalProof: string[];
  /** Stated on every result so a green gate cannot be quoted as evidence. */
  meaning: string;
}

const MEANING_READY =
  'READY TO ATTEMPT A BOUNDED PILOT — this is not E4, and no pilot has occurred.';
const MEANING_NOT_READY =
  'NOT READY — one or more prerequisites are unmet or untested.';

export function evaluateSupportPilotReadiness(
  observation: ReadinessObservation,
): ReadinessResult {
  const failed = READINESS_DIMENSIONS.filter((d) => observation.exercised[d] === false);
  const unexercised = READINESS_DIMENSIONS.filter((d) => observation.exercised[d] === undefined);
  const ready = failed.length === 0 && unexercised.length === 0;

  // Outstanding external proof does not block readiness — it is the whole
  // reason a pilot would be attempted — but it is carried on every result so it
  // cannot be quietly dropped when the gate goes green.
  return {
    version: SUPPORT_PILOT_READINESS_VERSION,
    ready, failed: [...failed], unexercised: [...unexercised],
    outstandingExternalProof: observation.outstandingExternalProof,
    meaning: ready ? MEANING_READY : MEANING_NOT_READY,
  };
}

/** Proof debt that a green readiness result explicitly does NOT discharge. */
export const OUTSTANDING_EXTERNAL_PROOF = [
  'No real founder has granted authority, authored a reply, or revoked permission.',
  'No real customer message has arrived from a real provider.',
  'No real reply has been delivered to a real customer.',
  'Business outcome has never been independently established — only ever unresolved.',
  'Founder attention reduction is unmeasured and unclaimed.',
  'Autonomous reply generation does not exist; the human baseline is the only content source.',
] as const;
