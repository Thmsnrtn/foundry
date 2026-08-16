// =============================================================================
// FOUNDRY — First bounded development Assisting vertical
//
//   plan  →  revalidate authority  →  mutate  →  verify  →  outcome  →  learn
//
// Each arrow is a real boundary, not a formality:
//   a plan is not an execution — planning writes nothing to the repository;
//   an execution is not a verification — a write that did not throw proves
//     nothing about what is on disk;
//   a verification is not an outcome — passing checks are not a business
//     result;
//   an outcome is not authority — nothing here promotes anything.
//
// Authority is revalidated immediately before mutation. A plan made while a
// grant was valid must not execute after that grant expired or was revoked.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { recordReconstructionClaim } from './reconstruction.js';
import { enterResponsibilityAssisting } from './responsibility-assisting.js';
import { getCurrentDevelopmentAuthority, isPathWithinAuthority } from './development-authority.js';
import { decideDevelopmentDisposition } from './development-disposition.js';
import {
  applyRepositoryChange, contentDigest, readRepositoryFile, repositoryChangeId,
  rollbackRepositoryChange, type RepositoryChangeReceipt,
} from './repository-change.js';
import type { Responsibility } from './responsibility.js';

export interface DevelopmentChangePlan {
  id: string; changeId: string; targetPath: string; contentDigest: string;
  /** The content the institution selected, present when the plan was just made. */
  intendedContent?: string;
  status: 'planned' | 'claimed' | 'applied' | 'already_applied' | 'refused' | 'rolled_back';
  refusedReason: string | null;
}

/** Enter Assisting through the ordinary verifier. Nothing development-specific. */
export async function enterDevelopmentAssisting(input: {
  productId: string; responsibilityId: string; shadowComparisonId: string; authorityConsentId: string;
}): Promise<Responsibility> {
  return enterResponsibilityAssisting(input);
}

/**
 * Plan the change Foundry has concluded should be made.
 *
 * What to change is *derived* from the disposition, not supplied by the
 * caller: the institution selects the change from its own grounded evidence,
 * and any disposition other than `change` — investigate, configure, delete,
 * defer, do nothing — stops here rather than becoming a plan anyway.
 *
 * This writes nothing to the repository. Replaying the same proposal
 * converges on the one existing plan rather than creating a second.
 */
export async function planDevelopmentChange(input: {
  productId: string; responsibilityId: string; repository: string;
}): Promise<DevelopmentChangePlan> {
  const decision = await decideDevelopmentDisposition(input.productId, input.responsibilityId);
  if (decision.disposition !== 'change' || !decision.change) {
    throw new Error(`development plan refused: disposition is ${decision.disposition}`);
  }
  const { path, content, changeClass } = decision.change;

  const authority = await getCurrentDevelopmentAuthority(input.productId, input.responsibilityId);
  if (!authority) throw new Error('development plan refused: no current authority');
  if (authority.repository !== input.repository) throw new Error('development plan refused: repository not authorized');
  if (authority.changeClass !== changeClass) throw new Error('development plan refused: change class not authorized');
  if (!isPathWithinAuthority(path, authority)) throw new Error('development plan refused: path not authorized');

  const changeId = repositoryChangeId({
    productId: input.productId, responsibilityId: input.responsibilityId, path, content,
  });
  const digest = contentDigest(content);

  const id = nanoid();
  try {
    await query(
      `INSERT INTO development_change_plans
       (id,product_id,responsibility_id,authority_consent_id,change_id,repository_ref,target_path,change_class,
        content_digest,disposition,disposition_evidence_json)
       VALUES (?,?,?,?,?,?,?,?,?,'change',?)`,
      [id, input.productId, input.responsibilityId, authority.consentId, changeId,
        input.repository, path, changeClass, digest, JSON.stringify(decision.evidence)],
    );
  } catch (error) {
    const existing = await getDevelopmentChangePlanByChangeId(input.productId, changeId);
    if (!existing) throw error;
    return existing;
  }
  return { id, changeId, targetPath: path, contentDigest: digest, intendedContent: content, status: 'planned', refusedReason: null };
}

async function projectPlan(row: Record<string, unknown>): Promise<DevelopmentChangePlan> {
  return {
    id: String(row.id), changeId: String(row.change_id), targetPath: String(row.target_path),
    contentDigest: String(row.content_digest),
    status: String(row.status) as DevelopmentChangePlan['status'],
    refusedReason: (row.refused_reason as string | null) ?? null,
  };
}

export async function getDevelopmentChangePlanByChangeId(
  productId: string, changeId: string,
): Promise<DevelopmentChangePlan | null> {
  const row = (await query(
    'SELECT * FROM development_change_plans WHERE product_id=? AND change_id=?', [productId, changeId],
  )).rows[0] as Record<string, unknown> | undefined;
  return row ? projectPlan(row) : null;
}

/**
 * Execute one planned change against the repository.
 *
 * Authority is revalidated here — not at plan time — because the interval
 * between deciding and acting is exactly where a grant expires or is revoked.
 * The plan is atomically claimed first, so two concurrent executions produce
 * one mutation; a refusal records why and mutates nothing.
 */
export async function executeDevelopmentChange(input: {
  productId: string; planId: string; repositoryRoot: string; content: string;
}): Promise<{ plan: DevelopmentChangePlan; receipt: RepositoryChangeReceipt | null }> {
  const row = (await query(
    'SELECT * FROM development_change_plans WHERE id=? AND product_id=?', [input.planId, input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('development execution refused');

  const responsibilityId = String(row.responsibility_id);
  const targetPath = String(row.target_path);

  // Atomic claim: whoever moves it out of `planned` owns the single execution.
  const claim = await query(
    "UPDATE development_change_plans SET status='claimed' WHERE id=? AND product_id=? AND status='planned'",
    [input.planId, input.productId],
  );
  if (Number(claim.rowsAffected) !== 1) {
    return { plan: (await getDevelopmentChangePlanByChangeId(input.productId, String(row.change_id)))!, receipt: null };
  }

  const refuse = async (reason: string) => {
    await query(
      "UPDATE development_change_plans SET status='refused',refused_reason=? WHERE id=? AND product_id=?",
      [reason, input.planId, input.productId],
    );
    return { plan: { ...await projectPlan(row), status: 'refused' as const, refusedReason: reason }, receipt: null };
  };

  // The last meaningful point before irreversible mutation.
  const authority = await getCurrentDevelopmentAuthority(input.productId, responsibilityId);
  if (!authority) return refuse('authority_absent');
  if (authority.consentId !== String(row.authority_consent_id)) return refuse('authority_changed');
  if (authority.repository !== String(row.repository_ref)) return refuse('repository_not_authorized');
  if (authority.changeClass !== String(row.change_class)) return refuse('change_class_not_authorized');
  if (!isPathWithinAuthority(targetPath, authority)) return refuse('path_not_authorized');

  // The content must be the content that was planned, checked BEFORE anything
  // is written. Discovering a mismatch from the receipt would mean the
  // unauthorized bytes were already on disk.
  const offered = repositoryChangeId({
    productId: input.productId, responsibilityId, path: targetPath, content: input.content,
  });
  if (offered !== String(row.change_id)) return refuse('content_does_not_match_plan');

  const receipt = applyRepositoryChange({
    repositoryRoot: input.repositoryRoot, path: targetPath, content: input.content,
    productId: input.productId, responsibilityId,
  });
  if (receipt.status === 'refused') return refuse(receipt.refusedReason ?? 'refused');

  await query(
    `UPDATE development_change_plans SET status=?,applied_at=CURRENT_TIMESTAMP,prior_existed=?,prior_content_digest=?
     WHERE id=? AND product_id=?`,
    [receipt.status, receipt.priorExisted ? 1 : 0,
      receipt.priorContent === null ? null : contentDigest(receipt.priorContent),
      input.planId, input.productId],
  );
  return { plan: { ...await projectPlan(row), status: receipt.status, refusedReason: null }, receipt };
}

/**
 * Verify the change independently.
 *
 * Two separate things must both hold: the bytes on disk are re-read and
 * compared against what was authorized (never inferred from a successful
 * write), and the required checks must appear among independently recorded
 * development observations. A check nobody ran is `unresolved`, not a pass.
 */
export async function verifyDevelopmentChange(input: {
  productId: string; planId: string; repositoryRoot: string; expectedContent: string;
}): Promise<{ diffVerified: boolean; verificationStatus: 'passed' | 'failed' | 'unresolved'; evidence: string[] }> {
  const row = (await query(
    'SELECT * FROM development_change_plans WHERE id=? AND product_id=?', [input.planId, input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('development verification refused');

  const responsibilityId = String(row.responsibility_id);
  const onDisk = readRepositoryFile(input.repositoryRoot, String(row.target_path));
  const diffVerified = onDisk !== null && repositoryChangeId({
    productId: input.productId, responsibilityId, path: String(row.target_path), content: onDisk,
  }) === String(row.change_id) && onDisk === input.expectedContent;

  // The verification that must hold is the one bound to the consent that
  // authorized this change, not whatever a current grant happens to say.
  const consent = (await query(
    'SELECT required_verification_json FROM autonomy_consents WHERE id=? AND product_id=?',
    [String(row.authority_consent_id), input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  const required = JSON.parse(String(consent?.required_verification_json ?? '[]')) as string[];

  // Strictly after the change: an observation recorded before the bytes moved
  // cannot verify them. Where timestamp resolution makes the order ambiguous
  // the check stays unresolved rather than being credited to this change.
  const observations = (await query(
    `SELECT id,payload_json FROM signal_events
     WHERE product_id=? AND source='development_verification' AND datetime(created_at)>datetime(?)
     ORDER BY created_at,rowid`,
    [input.productId, String(row.applied_at ?? row.created_at)],
  )).rows as Array<Record<string, unknown>>;

  const results = new Map<string, string>();
  const evidence: string[] = [];
  for (const observation of observations) {
    const payload = JSON.parse(String(observation.payload_json)) as { check?: string; result?: string };
    if (!payload.check || !required.includes(payload.check)) continue;
    // A later contradicting run is never overwritten by an earlier pass.
    if (results.get(payload.check) === 'failed') continue;
    results.set(payload.check, String(payload.result));
    evidence.push(String(observation.id));
  }

  const verificationStatus = required.some((check) => results.get(check) === 'failed') ? 'failed'
    : required.every((check) => results.get(check) === 'passed') ? 'passed'
      : 'unresolved';

  await query(
    'UPDATE development_change_plans SET diff_verified=?,verification_status=?,verification_evidence_json=? WHERE id=? AND product_id=?',
    [diffVerified ? 1 : 0, verificationStatus, JSON.stringify(evidence), input.planId, input.productId],
  );
  return { diffVerified, verificationStatus, evidence };
}

/**
 * Record what was actually achieved, and learn from it.
 *
 * A verified success requires an applied change, independently passing
 * verification, and matching bytes on disk — the database enforces this too.
 * Learning is provenance-bearing and moves no responsibility forward.
 */
export async function recordDevelopmentOutcome(input: {
  productId: string; planId: string;
}): Promise<{ outcomeStatus: 'verified_success' | 'verified_failure' | 'unresolved'; learnedClaimId: string | null }> {
  const row = (await query(
    'SELECT * FROM development_change_plans WHERE id=? AND product_id=?', [input.planId, input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('development outcome refused');

  const applied = ['applied', 'already_applied'].includes(String(row.status));
  const outcomeStatus = applied && row.verification_status === 'passed' && Number(row.diff_verified) === 1
    ? 'verified_success' as const
    : row.verification_status === 'failed' ? 'verified_failure' as const
      : 'unresolved' as const;

  const evidence = JSON.parse(String(row.verification_evidence_json ?? '[]')) as string[];
  const learnedClaimId = evidence.length
    ? await recordReconstructionClaim({
      productId: input.productId, subject: `responsibility:${String(row.responsibility_id)}`,
      predicate: 'development_change_outcome',
      value: { changeId: String(row.change_id), path: String(row.target_path), outcome: outcomeStatus },
      epistemicStatus: outcomeStatus === 'unresolved' ? 'unknown' : 'known',
      evidenceRefs: evidence.map((id) => ({ kind: 'signal_event' as const, id })),
      derivationMethod: 'bounded development change verification', observedAt: new Date(),
    })
    : null;

  await query(
    'UPDATE development_change_plans SET outcome_status=?,learned_claim_id=? WHERE id=? AND product_id=?',
    [outcomeStatus, learnedClaimId, input.planId, input.productId],
  );
  return { outcomeStatus, learnedClaimId };
}

/** Reverse an applied change and say so in the ledger. */
export async function rollbackDevelopmentChange(input: {
  productId: string; planId: string; repositoryRoot: string; receipt: RepositoryChangeReceipt;
}): Promise<boolean> {
  const row = (await query(
    'SELECT target_path FROM development_change_plans WHERE id=? AND product_id=?', [input.planId, input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return false;

  const reversed = rollbackRepositoryChange(input.repositoryRoot, String(row.target_path), input.receipt);
  if (reversed) {
    // Once the change is reversed there is no verified effect in the
    // repository any more, so no verified outcome may keep standing. What was
    // learned survives in its append-only claim; the plan records current
    // truth, not a memory of a success that has been undone.
    await query(
      "UPDATE development_change_plans SET status='rolled_back',outcome_status='unresolved' WHERE id=? AND product_id=?",
      [input.planId, input.productId],
    );
  }
  return reversed;
}
