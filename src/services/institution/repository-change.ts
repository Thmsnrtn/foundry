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
// no authority could ever permit — escaping the repository, writing through a
// symlink, or touching the constitutional ring.
//
// IT DID NOT REFUSE THE LAST ONE OF THOSE. `confine` resolved only the PARENT
// chain: it started at `dirname(absolute)` and re-appended the basename
// unresolved, so the final component was never realpath'd. A symlink at
// `docs/db/artifact.sql` pointing at `../../src/db/migrations/999.sql` passed
// every check — `isConstitutionalPath` saw the requested path, not the target —
// and the write followed the link into the constitutional ring. One pointing
// outside the repository was written through just as happily. The claim above
// was made in a comment by the module whose whole job is to be the thing that
// cannot be talked around.
//
// The rule is now a bright line rather than a resolution: a final component
// that IS a symlink is refused outright, whatever it points at. Nothing here
// creates symlinks, no bounded development change needs to write through one,
// and a kernel is worth more when its rule fits in a sentence.
// =============================================================================

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

/** Confines a repository-relative path to the repository, symlinks included —
 *  parent components resolved, and a symlinked final component refused. */
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

  // THE LAST COMPONENT IS A PATH TOO. The loop above deliberately stops at the
  // parent, so without this the one segment the write actually opens is the one
  // segment nothing checked. `lstat` rather than `stat`: a DANGLING symlink
  // must be refused as well, and that is the case where the damage does not
  // even roll back — `priorExisted` is false, the write CREATES the target, and
  // rollback removes the link while the created file stays.
  try {
    if (lstatSync(absolute).isSymbolicLink()) return { reason: 'path_is_symlink' };
  } catch { /* nothing there yet: there is no link to follow. */ }

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
