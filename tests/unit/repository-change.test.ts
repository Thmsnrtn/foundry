import { mkdirSync, mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRepositoryChange, readRepositoryFile, repositoryChangeId,
  rollbackRepositoryChange, type RepositoryChangeRequest,
} from '../../src/services/institution/repository-change.js';

let root: string;
let outside: string;

const change = (overrides: Partial<RepositoryChangeRequest> = {}): RepositoryChangeRequest => ({
  repositoryRoot: root, path: 'docs/db/schema.snapshot.sql', content: '-- regenerated\n',
  productId: 'rc_product', responsibilityId: 'rc_resp', ...overrides,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'foundry-repo-'));
  outside = mkdtempSync(join(tmpdir(), 'foundry-outside-'));
  mkdirSync(join(root, 'docs/db'), { recursive: true });
  writeFileSync(join(root, 'docs/db/schema.snapshot.sql'), '-- stale\n');
});

describe('governed repository change', () => {
  it('applies a bounded change and records an exercisable rollback', () => {
    const receipt = applyRepositoryChange(change());
    expect(receipt).toMatchObject({ status: 'applied', refusedReason: null, priorExisted: true, priorContent: '-- stale\n' });
    expect(readFileSync(join(root, 'docs/db/schema.snapshot.sql'), 'utf8')).toBe('-- regenerated\n');

    expect(rollbackRepositoryChange(root, 'docs/db/schema.snapshot.sql', receipt)).toBe(true);
    expect(readFileSync(join(root, 'docs/db/schema.snapshot.sql'), 'utf8')).toBe('-- stale\n');
  });

  it('reverses a created file by deleting it', () => {
    const receipt = applyRepositoryChange(change({ path: 'docs/db/new-artifact.sql', content: 'x\n' }));
    expect(receipt).toMatchObject({ status: 'applied', priorExisted: false, priorContent: null });
    expect(existsSync(join(root, 'docs/db/new-artifact.sql'))).toBe(true);

    expect(rollbackRepositoryChange(root, 'docs/db/new-artifact.sql', receipt)).toBe(true);
    expect(existsSync(join(root, 'docs/db/new-artifact.sql'))).toBe(false);
  });

  it('keeps change identity stable and replay a no-op rather than a second mutation', () => {
    const first = applyRepositoryChange(change());
    const replay = applyRepositoryChange(change());
    expect(replay.changeId).toBe(first.changeId);
    expect(replay.status).toBe('already_applied');
    expect(replay.contentDigest).toBe(first.contentDigest);

    // Identity is content- and responsibility-derived, not a fresh id per call.
    expect(repositoryChangeId({ productId: 'rc_product', responsibilityId: 'rc_resp', path: 'docs/db/schema.snapshot.sql', content: '-- regenerated\n' }))
      .toBe(first.changeId);
    expect(repositoryChangeId({ productId: 'rc_product', responsibilityId: 'rc_resp', path: 'docs/db/schema.snapshot.sql', content: '-- different\n' }))
      .not.toBe(first.changeId);
    expect(repositoryChangeId({ productId: 'other', responsibilityId: 'rc_resp', path: 'docs/db/schema.snapshot.sql', content: '-- regenerated\n' }))
      .not.toBe(first.changeId);

    // A rollback receipt from a no-op change reverses nothing.
    expect(rollbackRepositoryChange(root, 'docs/db/schema.snapshot.sql', replay)).toBe(false);
  });

  it('refuses the constitutional ring even when the caller insists', () => {
    for (const path of [
      'src/db/migrations/999_new.sql', 'docs/foundry-institution/CONSTITUTION.md',
      'scripts/ratchet.mjs', 'src/services/institution/responsibility.ts',
      'src/services/outbound/gateway.ts', 'AGENTS.md',
    ]) {
      const receipt = applyRepositoryChange(change({ path, content: 'compromised\n' }));
      expect(receipt).toMatchObject({ status: 'refused', refusedReason: 'constitutional_path' });
      expect(existsSync(resolve(root, path))).toBe(false);
    }
  });

  it('refuses escapes, absolute paths, and symlinks that leave the repository', () => {
    writeFileSync(join(outside, 'target.txt'), 'original\n');
    symlinkSync(outside, join(root, 'escape'));

    for (const [path, reason] of [
      ['../outside.txt', 'path_invalid'],
      ['docs/../../outside.txt', 'path_invalid'],
      ['/etc/passwd', 'path_invalid'],
      ['', 'path_invalid'],
      ['escape/target.txt', 'path_escapes_repository'],
      ['escape/new.txt', 'path_escapes_repository'],
    ] as const) {
      expect(applyRepositoryChange(change({ path, content: 'compromised\n' })))
        .toMatchObject({ status: 'refused', refusedReason: reason });
    }
    // Nothing outside the repository was touched or created.
    expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe('original\n');
    expect(existsSync(join(outside, 'new.txt'))).toBe(false);
  });

  it('refuses a symlinked directory that reaches back into the constitutional ring', () => {
    mkdirSync(join(root, 'src/db/migrations'), { recursive: true });
    mkdirSync(join(root, 'docs/db/link'), { recursive: true });
    symlinkSync(join(root, 'src/db/migrations'), join(root, 'docs/db/ring'));

    const receipt = applyRepositoryChange(change({ path: 'docs/db/ring/999_new.sql', content: 'compromised\n' }));
    expect(receipt).toMatchObject({ status: 'refused', refusedReason: 'constitutional_path' });
    expect(existsSync(join(root, 'src/db/migrations/999_new.sql'))).toBe(false);
  });

  it('reads back what is actually on disk rather than what was intended', () => {
    applyRepositoryChange(change());
    expect(readRepositoryFile(root, 'docs/db/schema.snapshot.sql')).toBe('-- regenerated\n');
    expect(readRepositoryFile(root, 'docs/db/absent.sql')).toBeNull();
    // Verification cannot be used to peek outside the repository or into the ring.
    expect(readRepositoryFile(root, 'AGENTS.md')).toBeNull();
    expect(readRepositoryFile(root, '../outside.txt')).toBeNull();
  });
});

describe('the last path component is a path too', () => {
  // The confinement loop deliberately stops at `dirname(absolute)` and
  // re-appends the basename UNRESOLVED, so the one segment the write actually
  // opens was the one segment nothing checked. Every case below wrote straight
  // through before, while the module header claimed it refused exactly this.

  it('refuses a symlink whose target is inside the constitutional ring', () => {
    mkdirSync(join(root, 'src/db/migrations'), { recursive: true });
    writeFileSync(join(root, 'src/db/migrations/999_target.sql'), '-- the ring\n');
    symlinkSync('../../src/db/migrations/999_target.sql', join(root, 'docs/db/artifact.sql'));

    const receipt = applyRepositoryChange(change({ path: 'docs/db/artifact.sql', content: 'DROP TABLE decisions;\n' }));

    // `isConstitutionalPath` was asked about the REQUESTED path, which is not
    // in the ring. It was never asked about where the path leads.
    expect(receipt).toMatchObject({ status: 'refused', refusedReason: 'path_is_symlink' });
    expect(readFileSync(join(root, 'src/db/migrations/999_target.sql'), 'utf8')).toBe('-- the ring\n');
  });

  it('refuses a symlink whose target is outside the repository', () => {
    writeFileSync(join(outside, 'elsewhere.txt'), 'not ours\n');
    symlinkSync(join(outside, 'elsewhere.txt'), join(root, 'docs/db/escape.sql'));

    const receipt = applyRepositoryChange(change({ path: 'docs/db/escape.sql', content: 'ours now\n' }));

    expect(receipt).toMatchObject({ status: 'refused', refusedReason: 'path_is_symlink' });
    expect(readFileSync(join(outside, 'elsewhere.txt'), 'utf8')).toBe('not ours\n');
  });

  it('refuses a DANGLING symlink, which is the case rollback could not undo', () => {
    // Nothing at the target yet, so `priorExisted` would be false, the write
    // would CREATE a file in the ring, and rollback would remove the link and
    // leave the created file standing.
    mkdirSync(join(root, 'src/db/migrations'), { recursive: true });
    symlinkSync('../../src/db/migrations/998_new.sql', join(root, 'docs/db/pending.sql'));

    const receipt = applyRepositoryChange(change({ path: 'docs/db/pending.sql', content: 'created\n' }));

    expect(receipt).toMatchObject({ status: 'refused', refusedReason: 'path_is_symlink' });
    expect(existsSync(join(root, 'src/db/migrations/998_new.sql'))).toBe(false);
  });

  it('still refuses a symlinked PARENT, which is what the loop was for', () => {
    symlinkSync(outside, join(root, 'docs/linked'));

    const receipt = applyRepositoryChange(change({ path: 'docs/linked/file.sql', content: 'x\n' }));

    expect(receipt.status).toBe('refused');
    expect(receipt.refusedReason).toBe('path_escapes_repository');
  });

  it('does not refuse an ordinary file, which is the point of a bright line', () => {
    // The rule is "a symlinked final component is refused", not "anything
    // unusual is refused" — a kernel that says no to everything protects
    // nothing, because it stops being used.
    expect(applyRepositoryChange(change()).status).toBe('applied');
  });
});
