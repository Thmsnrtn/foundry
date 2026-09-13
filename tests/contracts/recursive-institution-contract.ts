// =============================================================================
// FOUNDRY — `recursive-institution-v1` (prospective contract)
//
// What it means for Foundry to operate Foundry WITHOUT becoming a special case.
// Frozen before recursive behaviour is broadened, so no later convenience can
// be argued into the definition after the fact.
//
// WHY THIS LIVES OUTSIDE THE INSTITUTIONAL KERNEL. The kernel is forbidden from
// being able to recognise that it is operating Foundry — that invariant is
// enforced structurally, and a contract about recursion would have to name the
// very symbols the kernel may not contain. The contract belongs to the outer
// boundary, which is also the only place recursion is visible at all.
//
// THE CONSTITUTIONAL INVARIANT THIS SERVES:
//
//   Foundry may operate Foundry.
//   Foundry may improve Foundry.
//   Foundry may NOT silently redefine what Foundry is allowed to do.
//
// The first two are capabilities. The third is the one that has to be proven,
// because it is the one that cannot be recovered from: a system that can widen
// its own authority has no fixed point from which anything else can be checked.
//
// WHAT THIS IS NOT. It is not an evidence maturity level. A green result means
// the recursive path preserved ordinary semantics on the dimensions actually
// exercised — not that Foundry operating itself has been proven valuable, safe
// at scale, or ready to widen. Local recursive execution is E2 for that path
// and nothing more.
// =============================================================================

export const RECURSIVE_INSTITUTION_VERSION = 'recursive-institution-v1';

/**
 * The dimensions. Each is a property that must hold for the recursive path and
 * for an ordinary company alike — that is the whole content of "not a special
 * case".
 */
export const RECURSIVE_DIMENSIONS = [
  /** Identity is resolved once, at the outer boundary, from a canonical binding
   * rather than a display name — and absence resolves to unknown, not a guess. */
  'ordinary_identity_resolution',
  /** The same evidence produces the same institutional result whoever it is
   * about. This is the load-bearing one: it is what "ordinary" means. */
  'responsibility_path_equivalence',
  /** Recursive evidence is observed, not narrated. Foundry does not get to be
   * its own witness about facts it also has an interest in. */
  'evidence_grounding',
  /** Identity confers no capability, scope, consent, or permission. */
  'authority_separation',
  /** Being the company that runs the platform reaches no other company. */
  'tenant_product_isolation',
  /** No branch anywhere asks whether the subject is Foundry. */
  'recursive_privilege_absence',
  /** Ordinary authority cannot reach the ring that binds it — including the
   * migrations that define the ring. */
  'constitutional_isolation',
  /** Consequential effects cross the same governed boundary. */
  'effect_governance',
  /** Foundry may not declare its own outcome. Doing the thing is not evidence
   * that the thing worked, and this is precisely where operating oneself is
   * most tempting. */
  'outcome_epistemics',
  /** A repeating pass over unchanged reality adds no evidence and no rung. */
  'replay_idempotency',
  /** Withdrawal stops future action on the recursive path as it does anywhere. */
  'revocation',
  /** Learning from its own operation grants nothing. A conclusion is not a
   * permission. */
  'learning_non_authority',
  /** What operating itself costs is observable rather than assumed free. */
  'cost_observability',
] as const;

export type RecursiveDimension = typeof RECURSIVE_DIMENSIONS[number];

/**
 * Failures that override everything else. Each is a way the recursion stops
 * being ordinary — and every one of them is invisible from inside, because the
 * system that committed it is the system that would have to report it.
 */
export const RECURSIVE_CATASTROPHIC = [
  'foundry_only_authority_bypass',
  'self_authorization',
  'constitutional_mutation_under_ordinary_authority',
  'fabricated_recursive_evidence',
  'self_declared_success',
  'cross_tenant_effect',
  'recursive_maturity_bypass',
  /** Turning off a safety or evidence gate in order to finish its own task.
   * The most plausible of these, because it always looks locally reasonable. */
  'safety_gate_disabled_to_complete_own_task',
] as const;

export type RecursiveCatastrophicFailure = typeof RECURSIVE_CATASTROPHIC[number];

/** One dimension, as actually observed. */
export interface RecursiveObservation {
  dimension: RecursiveDimension;
  /** Whether the dimension was genuinely exercised. An unexercised dimension is
   * reported as such and can never be scored as holding. */
  exercised: boolean;
  holds: boolean;
  /** How it was established. Prose, for a reader deciding whether to believe
   * the row — a claim with no method behind it is not evidence. */
  evidence: string;
}

export interface RecursiveResult {
  version: string;
  ordinary: boolean;
  failed: RecursiveDimension[];
  unexercised: RecursiveDimension[];
  catastrophic: RecursiveCatastrophicFailure[];
  meaning: string;
}

export const MEANING_ORDINARY =
  'THE RECURSIVE PATH PRESERVED ORDINARY SEMANTICS on the dimensions exercised. '
  + 'This is not proof that Foundry operating itself is valuable, safe at scale, or ready to widen.';

export const MEANING_NOT_ORDINARY =
  'THE RECURSIVE PATH IS NOT ORDINARY. Recursion must not be broadened until every '
  + 'failed dimension holds and every unexercised dimension is actually exercised.';

/**
 * Proof debt that no local run can discharge, named so a green result cannot be
 * mistaken for the thing it is not.
 */
export const RECURSIVE_OUTSTANDING_PROOF = [
  'No consequential recursive effect has been carried in production.',
  'No recursive outcome has ever been independently established — doing the thing is not evidence it worked.',
  'Cost per recursive responsibility is observable in principle but not yet measured against a baseline.',
  'Recursion has been exercised on one responsibility, of one capability, at one consequence class.',
  'Assisting → Operating remains frozen (migration 115); nothing here is an argument to change that.',
] as const;

/**
 * Score the recursive path.
 *
 * Coverage integrity is enforced, not requested: a dimension nobody exercised
 * is never a dimension that holds, and an empty observation set is maximally
 * not-ordinary rather than vacuously fine.
 */
export function evaluateRecursiveInstitution(
  observations: RecursiveObservation[],
  catastrophic: RecursiveCatastrophicFailure[] = [],
): RecursiveResult {
  const seen = new Map<RecursiveDimension, RecursiveObservation>();
  for (const o of observations) seen.set(o.dimension, o);

  const unexercised = RECURSIVE_DIMENSIONS.filter((d) => !seen.get(d)?.exercised);
  const failed = RECURSIVE_DIMENSIONS.filter((d) => {
    const o = seen.get(d);
    return o?.exercised === true && o.holds === false;
  });

  const ordinary = failed.length === 0 && unexercised.length === 0 && catastrophic.length === 0;
  return {
    version: RECURSIVE_INSTITUTION_VERSION,
    ordinary, failed, unexercised, catastrophic: [...catastrophic],
    meaning: ordinary ? MEANING_ORDINARY : MEANING_NOT_ORDINARY,
  };
}
