// =============================================================================
// FOUNDRY — Knowing when not to code
//
// A development institution that can only build is not a development
// institution. Given an evidenced development need, the right answer is often
// to investigate, configure, delete, defer, or do nothing — and coding is
// chosen only when the evidence actually grounds a specific change.
//
// Deterministic and zero-model. Nothing here creates authority, and only a
// `change` disposition may produce a plan.
// =============================================================================

import { getReconstructionClaims, type ReconstructionClaim } from './reconstruction.js';
import type { DevelopmentChangeClass } from './development-authority.js';

export type DevelopmentDisposition =
  | 'do_nothing'    // nothing evidences work
  | 'investigate'   // the need is real or unclear, but what to do is not known
  | 'defer'         // evidence conflicts, or something blocks it
  | 'configure'     // an existing capability already covers it
  | 'delete'        // the need exists because something obsolete still does
  | 'change';       // a specific, grounded, bounded change is warranted

export interface DevelopmentDispositionResult {
  disposition: DevelopmentDisposition;
  rationale: string;
  /** Claim ids that grounded this answer. Empty only for `do_nothing`. */
  evidence: string[];
  /** Present only for `change`. */
  change: { path: string; content: string; changeClass: DevelopmentChangeClass } | null;
}

const CHANGE_CLASSES: DevelopmentChangeClass[] = ['generated_artifact', 'test', 'documentation'];
const CURRENT = ['known', 'inferred'];

const forSubject = (claims: ReconstructionClaim[], subject: string, predicate: string) =>
  claims.filter((claim) => claim.subject === subject && claim.predicate === predicate);

/**
 * Decide what to do about a development need.
 *
 * Precedence encodes the institution's judgement, not convenience:
 * absent evidence means nothing to do; unclear or stale evidence means
 * investigate rather than guess; conflict or a blocker means defer rather
 * than push through; an available alternative beats writing code; and only a
 * single current, grounded, well-formed intended change justifies changing
 * the repository.
 */
export async function decideDevelopmentDisposition(
  productId: string, responsibilityId: string, now: Date = new Date(),
): Promise<DevelopmentDispositionResult> {
  const claims = await getReconstructionClaims(productId, now);
  const subject = `responsibility:${responsibilityId}`;

  const needs = forSubject(claims, subject, 'development_need');
  if (!needs.length) {
    return { disposition: 'do_nothing', rationale: 'No current evidence describes a development need', evidence: [], change: null };
  }
  const ids = (list: ReconstructionClaim[]) => list.map((claim) => claim.id);

  if (needs.some((claim) => claim.epistemicStatus === 'conflicting')) {
    return { disposition: 'defer', rationale: 'The evidence about this need conflicts', evidence: ids(needs), change: null };
  }
  if (!needs.some((claim) => CURRENT.includes(claim.epistemicStatus))) {
    return {
      disposition: 'investigate',
      rationale: 'The need is recorded but unknown or stale, so nothing is established to act on',
      evidence: ids(needs), change: null,
    };
  }

  const blockers = forSubject(claims, subject, 'development_blocker').filter((c) => CURRENT.includes(c.epistemicStatus));
  if (blockers.length) {
    return { disposition: 'defer', rationale: 'A recorded constraint blocks acting on this need now', evidence: ids([...needs, ...blockers]), change: null };
  }

  // Not coding is preferred wherever the company already has an answer.
  const alternatives = forSubject(claims, subject, 'development_alternative').filter((c) => CURRENT.includes(c.epistemicStatus));
  for (const alternative of alternatives) {
    const kind = (alternative.value as { kind?: unknown })?.kind;
    if (kind === 'configure' || kind === 'existing_capability') {
      return { disposition: 'configure', rationale: 'An existing capability already covers this need', evidence: ids([...needs, alternative]), change: null };
    }
    if (kind === 'delete') {
      return { disposition: 'delete', rationale: 'The need exists because an obsolete path still does', evidence: ids([...needs, alternative]), change: null };
    }
  }

  const intended = forSubject(claims, subject, 'development_intended_content').filter((c) => CURRENT.includes(c.epistemicStatus));
  if (!intended.length) {
    return {
      disposition: 'investigate',
      rationale: 'The need is established but no grounded change describes what should differ',
      evidence: ids(needs), change: null,
    };
  }
  if (intended.length > 1) {
    return {
      disposition: 'defer',
      rationale: 'More than one grounded change is proposed for this need; which one is right is not established',
      evidence: ids([...needs, ...intended]), change: null,
    };
  }

  const value = intended[0].value as { path?: unknown; content?: unknown; changeClass?: unknown };
  if (typeof value?.path !== 'string' || typeof value.content !== 'string'
    || !CHANGE_CLASSES.includes(value.changeClass as DevelopmentChangeClass)) {
    return {
      disposition: 'investigate',
      rationale: 'The proposed change is not well formed enough to act on',
      evidence: ids([...needs, ...intended]), change: null,
    };
  }

  return {
    disposition: 'change',
    rationale: 'A single current, grounded, bounded change addresses the established need',
    evidence: ids([...needs, ...intended]),
    change: { path: value.path, content: value.content, changeClass: value.changeClass as DevelopmentChangeClass },
  };
}
