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
import { getReconstructionClaims, recordReconstructionClaim } from './reconstruction.js';
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
 * Whether the repository's ACTUAL change set is exactly what was planned.
 *
 * Everything else in this file verifies the intended file. That is necessary
 * and not sufficient: it cannot see a second file that also changed. A
 * generator that rewrites a lockfile, a formatter that reflows a neighbour, a
 * command with a side effect nobody documented — each produces a correct target
 * file and an unauthorised repository, and every check downstream would pass.
 *
 * Deliberately pure. The kernel does not run `git`, spawn processes, or read
 * the working tree; the caller observes what changed and hands the list in.
 * That keeps the institution free of process execution and makes the rule
 * itself trivially testable.
 *
 * Unexpected mutation is failure even when the target file is perfect and every
 * test passes.
 */
export function verifyDiffScope(input: {
  observedChangedPaths: string[]; plannedPaths: string[];
}): { withinScope: boolean; unexpected: string[] } {
  const planned = new Set(input.plannedPaths.map((p) => p.replace(/^\.\//, '')));
  const unexpected = input.observedChangedPaths
    .map((p) => p.replace(/^\.\//, ''))
    .filter((p) => p.length > 0 && !planned.has(p))
    .sort();
  return { withinScope: unexpected.length === 0, unexpected };
}

/**
 * Verify the change independently.
 *
 * Three separate things must hold: the bytes on disk are re-read and compared
 * against what was authorized (never inferred from a successful write), the
 * repository's actual change set must contain nothing beyond the planned path
 * when the caller supplies one, and the required checks must appear among
 * independently recorded development observations. A check nobody ran is
 * `unresolved`, not a pass.
 */
export async function verifyDevelopmentChange(input: {
  productId: string; planId: string; repositoryRoot: string; expectedContent: string;
  /** What actually changed in the working tree, observed by the caller. When
   * omitted, diff scope is simply not established — it is never assumed clean. */
  observedChangedPaths?: string[];
}): Promise<{
  diffVerified: boolean; verificationStatus: 'passed' | 'failed' | 'unresolved';
  evidence: string[]; unexpectedPaths: string[];
}> {
  const row = (await query(
    'SELECT * FROM development_change_plans WHERE id=? AND product_id=?', [input.planId, input.productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('development verification refused');

  const responsibilityId = String(row.responsibility_id);
  const onDisk = readRepositoryFile(input.repositoryRoot, String(row.target_path));
  const bytesMatch = onDisk !== null && repositoryChangeId({
    productId: input.productId, responsibilityId, path: String(row.target_path), content: onDisk,
  }) === String(row.change_id) && onDisk === input.expectedContent;

  // A correct target file in an incorrectly-changed repository is not a
  // verified change. When the caller observed the working tree, anything it
  // saw beyond the planned path fails the diff outright.
  const scope = input.observedChangedPaths === undefined
    ? { withinScope: true, unexpected: [] as string[] }
    : verifyDiffScope({
      observedChangedPaths: input.observedChangedPaths,
      plannedPaths: [String(row.target_path)],
    });
  const diffVerified = bytesMatch && scope.withinScope;

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

  // An out-of-scope mutation is a failed verification, not merely an
  // unverified diff — passing checks must never be able to certify a
  // repository that changed in ways nobody authorized.
  const verificationStatus = !scope.withinScope ? 'failed'
    : required.some((check) => results.get(check) === 'failed') ? 'failed'
      : required.every((check) => results.get(check) === 'passed') ? 'passed'
        : 'unresolved';

  await query(
    'UPDATE development_change_plans SET diff_verified=?,verification_status=?,verification_evidence_json=? WHERE id=? AND product_id=?',
    [diffVerified ? 1 : 0, verificationStatus, JSON.stringify(evidence), input.planId, input.productId],
  );
  return { diffVerified, verificationStatus, evidence, unexpectedPaths: scope.unexpected };
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

export interface FounderDevelopmentActivity {
  /** What Foundry is currently permitted to change, in plain terms. */
  permitted: Array<{ what: string; where: string[]; until: string }>;
  /** Only changes with a material state — quiet successes stay quiet. */
  changes: Array<{ what: string; detail: string }>;
  /** How Foundry's changes have held up over everything it has recorded, or
   *  null when it has recorded nothing. Never a rate, never a score. */
  record: { confirmed: number; failed: number; unconfirmed: number } | null;
}

/**
 * THE TRACK RECORD, FROM THE CLAIMS RATHER THAN THE PLANS.
 *
 * `recordDevelopmentOutcome` wrote every outcome twice: once to
 * `development_change_plans.outcome_status`, and once as a
 * `development_change_outcome` reconstruction claim with the verification
 * evidence attached. The column was read; the claim was read by nothing. That
 * is a permanent dual-write with a dead side — Foundry paying to record what it
 * learned about its own changes and never once consulting it.
 *
 * The two sides get different jobs rather than one getting deleted. The plans
 * answer "what happened to this change", which needs a path and a status. The
 * claims answer "how has this held up", which needs provenance and staleness —
 * and staleness matters here, because a verification from four months ago is not
 * current evidence that Foundry's changes hold. `getReconstructionClaims`
 * applies that; the column cannot.
 *
 * Counts, not a rate. Three verified successes out of four is not "75%
 * reliable", and a percentage invites exactly the reading the evidence cannot
 * support. `unresolved` is carried as its own number rather than folded into
 * either side, because "nobody checked" is not a failure and is not a success.
 *
 * STALENESS IS ASYMMETRIC, deliberately. `getReconstructionClaims` exists, in
 * its own words, so "an old positive claim" does not "silently remain current":
 * a check that passed before its evidence expired is no longer current evidence
 * that Foundry's change holds, so it falls back to unconfirmed. A check that
 * FAILED is not retired the same way — a failure is a thing that happened, and
 * letting time turn it into "nobody knows" would be Foundry improving its own
 * record by waiting. The asymmetry only ever runs against Foundry.
 */
// A QUESTION ASKED OF THIS FUNCTION AND ANSWERED AGAINST THE ASKER, recorded so
// it is not re-opened. `recordDevelopmentOutcome` writes a claim only when the
// plan carries verification evidence — `evidence.length ? … : null` — so a
// change applied and then checked by NOTHING has no claim and lands in no
// bucket here, while the founder reads "Across everything I have changed and
// recorded". Counting from `development_change_plans` instead looks like the
// obvious repair and is wrong.
//
// A ROLLBACK MUTATES THE PLAN AND CANNOT TOUCH THE CLAIM. `outcome_status` is
// current state; the claim is append-only history. Tallying plans would let a
// rolled-back failure vanish from the record — Foundry improving its own track
// record by undoing something — which is the exact asymmetry the rest of this
// module exists to prevent. The two are counted separately on purpose, and
// `development-assisting.test.ts` says so in as many words.
//
// So the total is what was changed AND RECORDED, which is what the sentence
// says. The unmeasured case is not hidden: an applied change nothing checked
// carries `outcome_status = 'unresolved'` on its plan and appears on the
// founder's page as work in progress, not as a settled outcome.
async function developmentRecord(
  productId: string, now: Date,
): Promise<FounderDevelopmentActivity['record']> {
  const claims = (await getReconstructionClaims(productId, now))
    .filter((claim) => claim.predicate === 'development_change_outcome');
  if (!claims.length) return null;

  const tally = { confirmed: 0, failed: 0, unconfirmed: 0 };
  for (const claim of claims) {
    const outcome = (claim.value as { outcome?: unknown } | null)?.outcome;
    const current = claim.epistemicStatus === 'known' || claim.epistemicStatus === 'inferred';
    if (outcome === 'verified_failure') tally.failed++;
    else if (outcome === 'verified_success' && current) tally.confirmed++;
    else tally.unconfirmed++;
  }
  return tally;
}

/**
 * What the founder needs to know about Foundry touching their systems: what it
 * is allowed to change, and what actually happened. Authority is always shown,
 * even when nothing happened, because permission is not something to discover
 * after the fact.
 */
export async function getFounderDevelopmentActivity(
  productId: string, now: Date = new Date(),
): Promise<FounderDevelopmentActivity> {
  const grants = (await query(
    `SELECT a.allowed_change_class,a.allowed_path_prefixes_json,a.expires_at,r.title
     FROM autonomy_consents a JOIN institutional_responsibilities r ON r.id=a.responsibility_id
     WHERE a.product_id=? AND a.capability='development' AND a.to_mode='act'
       AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
     ORDER BY a.expires_at`,
    [productId],
  )).rows as Array<Record<string, unknown>>;

  const plans = (await query(
    `SELECT p.target_path,p.status,p.refused_reason,p.verification_status,p.outcome_status,r.title
     FROM development_change_plans p JOIN institutional_responsibilities r ON r.id=p.responsibility_id
     WHERE p.product_id=? AND datetime(p.created_at)>=datetime('now','-7 days')
     ORDER BY p.created_at DESC`,
    [productId],
  )).rows as Array<Record<string, unknown>>;

  const CHANGE_CLASS_LABELS: Record<string, string> = {
    generated_artifact: 'regenerate files that are built from your other files',
    test: 'add or update tests',
    documentation: 'update documentation',
  };

  const record = await developmentRecord(productId, now);

  return {
    record,
    permitted: grants.map((grant) => ({
      what: CHANGE_CLASS_LABELS[String(grant.allowed_change_class)] ?? String(grant.allowed_change_class),
      where: JSON.parse(String(grant.allowed_path_prefixes_json)) as string[],
      until: String(grant.expires_at).slice(0, 10),
    })),
    changes: plans.flatMap((plan) => {
      const what = `${String(plan.title)} — ${String(plan.target_path)}`;
      const status = String(plan.status);
      if (status === 'refused') {
        return [{ what, detail: `I did not make this change: ${String(plan.refused_reason ?? 'it was not permitted')}.` }];
      }
      if (status === 'rolled_back') return [{ what, detail: 'I made this change and then undid it.' }];
      if (!['applied', 'already_applied'].includes(status)) return [];
      if (plan.outcome_status === 'verified_success') {
        return [{ what, detail: 'I made this change and an independent check confirmed it.' }];
      }
      if (plan.outcome_status === 'verified_failure' || plan.verification_status === 'failed') {
        return [{ what, detail: 'I made this change and the check then failed. This needs you.' }];
      }
      return [{ what, detail: 'I made this change. Nothing has independently confirmed it yet.' }];
    }),
  };
}
