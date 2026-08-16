// =============================================================================
// FOUNDRY — Governed repository change
//
// The one place a bounded, authorized development change actually touches a
// repository. Everything upstream of here — proposal, plan, expectation — is
// non-mutating by construction; this module is where consequence begins.
//
// It lives inside the constitutional ring on purpose: it cannot be modified by
// the authority it enforces.
//
// It grants nothing and checks nothing about who asked. Callers must already
// hold current, revalidated authority; this module independently refuses what
// no authority could ever permit — escaping the repository, following a
// symlink out of it, or touching the constitutional ring.
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { isConstitutionalPath } from './development-authority.js';

export interface RepositoryChangeRequest {
  repositoryRoot: string;
  /** Repository-relative path. Absolute paths and `..` escapes are refused. */
  path: string;
  /** The complete intended content of the file after the change. */
  content: string;
  /** Stable identity inputs, so the same change is the same change on replay. */
  productId: string;
  responsibilityId: string;
}

export type RepositoryChangeStatus = 'applied' | 'already_applied' | 'refused';

export interface RepositoryChangeReceipt {
  changeId: string;
  status: RepositoryChangeStatus;
  refusedReason: string | null;
  contentDigest: string;
  /** Exact prior content, or null if the file did not exist. The rollback path. */
  priorContent: string | null;
  priorExisted: boolean;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Content identity, independent of who proposed it or where it is going. */
export function contentDigest(content: string): string {
  return digest(content);
}

/**
 * Stable change identity. The same responsibility proposing the same content
 * for the same path is one change, however many times it is submitted.
 */
export function repositoryChangeId(input: {
  productId: string; responsibilityId: string; path: string; content: string;
}): string {
  return `chg_${digest([input.productId, input.responsibilityId, input.path, digest(input.content)].join(' ')).slice(0, 32)}`;
}

/** Confines a repository-relative path to the repository, symlinks included. */
function confine(repositoryRoot: string, path: string): { absolute: string } | { reason: string } {
  const normalized = path.replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return { reason: 'path_invalid' };
  if (isConstitutionalPath(normalized)) return { reason: 'constitutional_path' };

  const root = realpathSync(repositoryRoot);
  const absolute = resolve(root, normalized);
  if (!absolute.startsWith(root + sep)) return { reason: 'path_escapes_repository' };

  // A symlinked parent could point anywhere; resolve what exists of the chain.
  let existing = dirname(absolute);
  for (;;) {
    try {
      const real = realpathSync(existing);
      if (real !== root && !real.startsWith(root + sep)) return { reason: 'path_escapes_repository' };
      // Re-check the ring against the resolved location, not just the requested one.
      const resolvedRelative = relative(root, resolve(real, relative(existing, absolute)));
      if (isConstitutionalPath(resolvedRelative)) return { reason: 'constitutional_path' };
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return { reason: 'path_escapes_repository' };
      existing = parent;
    }
  }
  return { absolute };
}

/**
 * Apply one bounded change, or explain why it was refused.
 *
 * Idempotent: a file that already holds exactly the intended content is
 * reported `already_applied` and is not rewritten, so a replayed plan cannot
 * produce a second mutation. Prior content is captured before the write so
 * every applied change has a recorded, exercisable rollback.
 */
export function applyRepositoryChange(request: RepositoryChangeRequest): RepositoryChangeReceipt {
  const changeId = repositoryChangeId(request);
  const contentDigest = digest(request.content);
  const refused = (reason: string): RepositoryChangeReceipt => ({
    changeId, status: 'refused', refusedReason: reason, contentDigest,
    priorContent: null, priorExisted: false,
  });

  const confined = confine(request.repositoryRoot, request.path);
  if ('reason' in confined) return refused(confined.reason);

  let priorContent: string | null = null;
  try { priorContent = readFileSync(confined.absolute, 'utf8'); } catch { priorContent = null; }
  const priorExisted = priorContent !== null;

  if (priorContent === request.content) {
    return { changeId, status: 'already_applied', refusedReason: null, contentDigest, priorContent, priorExisted };
  }

  mkdirSync(dirname(confined.absolute), { recursive: true });
  writeFileSync(confined.absolute, request.content, 'utf8');
  return { changeId, status: 'applied', refusedReason: null, contentDigest, priorContent, priorExisted };
}

/**
 * Restore what was there before. Deletion is the correct reversal of creating
 * a file that did not previously exist.
 */
export function rollbackRepositoryChange(
  repositoryRoot: string, path: string, receipt: RepositoryChangeReceipt,
): boolean {
  if (receipt.status !== 'applied') return false;
  const confined = confine(repositoryRoot, path);
  if ('reason' in confined) return false;

  if (receipt.priorExisted) writeFileSync(confined.absolute, receipt.priorContent ?? '', 'utf8');
  else rmSync(confined.absolute, { force: true });
  return true;
}

/** Reads back what is actually on disk, for verification that is not self-reported. */
export function readRepositoryFile(repositoryRoot: string, path: string): string | null {
  const confined = confine(repositoryRoot, path);
  if ('reason' in confined) return null;
  try { return readFileSync(confined.absolute, 'utf8'); } catch { return null; }
}
