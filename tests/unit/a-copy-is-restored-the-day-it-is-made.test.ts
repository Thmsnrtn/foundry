process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

// =============================================================================
// A COPY IS RESTORED THE DAY IT IS MADE, AND THE OWNER CAN RESTORE ONE HIMSELF.
//
// Roadmap G5. `copyTheInstitution` writes a copy every day and
// `restoreTheInstitution` can put one back and compare what matters — but
// nothing ever called the second. So "backups are real; restore is unproven"
// stayed true every day, and the first time anybody learned whether a copy
// opened would have been the morning it was needed.
//
// Now the daily job restores the copy it has just written, beside the backups
// and never over the live database, and FAILS — so job health and the Brief say
// so — when that copy does not open, holds nobody, or cannot answer one of the
// questions a recovery has to answer. And the owner can run the same
// rehearsal on any copy with one command (`node dist/cli/index.js rehearse-restore`).
// Nothing is left behind by either.
// =============================================================================

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'foundry-rehearse-'));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, 'foundry.db')}`;
  const { runMigrations } = await import('../../src/db/migrate.js');
  const { query } = await import('../../src/db/client.js');
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    ['rh_owner', 'clerk_rh', 'owner@example.com', 'Owner']);
});

describe('the daily copy', () => {
  it('is restored as soon as it is written, and leaves nothing behind', async () => {
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    await expect(JOB_REGISTRY.keep_a_copy_of_everything.fn()).resolves.toBeUndefined();
    const left = await readdir(join(dir, 'backups'));
    expect(left.filter((n) => !/^foundry-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(n))).toEqual([]);
  });
});

describe('a rehearsal', () => {
  it('restores the newest copy and says what came back', async () => {
    const { rehearseRestore, sayRehearsal } = await import('../../src/services/institution/keeping.js');
    const r = await rehearseRestore();
    expect('skipped' in r).toBe(false);
    if ('skipped' in r) return;
    expect(r.opened).toBe(true);
    expect(r.founders).toBe(1);
    expect(r.liabilities.every((l) => l.same)).toBe(true);
    const said = sayRehearsal(r);
    expect(said.ok).toBe(true);
    expect(said.lines.join('\n')).toMatch(/opened/);
    expect(said.lines.join('\n')).toMatch(/what buyers are owed/);
  });

  it('fails a copy that does not open, and says so', async () => {
    const { rehearseRestore, sayRehearsal } = await import('../../src/services/institution/keeping.js');
    const bad = join(dir, 'backups', 'foundry-2099-01-01.db.gz');
    await writeFile(bad, gzipSync(Buffer.from('this is not a database')));
    // The newest by its date, so the default picks it.
    const r = await rehearseRestore();
    if ('skipped' in r) throw new Error('expected a rehearsal');
    expect(r.copy).toBe(bad);
    expect(r.opened).toBe(false);
    const said = sayRehearsal(r);
    expect(said.ok).toBe(false);
    expect(said.lines.join('\n')).toMatch(/did not open/);
    const left = await readdir(join(dir, 'backups'));
    expect(left.some((n) => n.includes('rehearsal'))).toBe(false);
  });

  it('fails a copy that holds nobody', async () => {
    const { sayRehearsal } = await import('../../src/services/institution/keeping.js');
    const said = sayRehearsal({ copy: 'x', opened: true, because: null, bytes: 1, tables: 3, founders: 0, liabilities: [] });
    expect(said.ok).toBe(false);
    expect(said.lines.join('\n')).toMatch(/nobody/);
  });

  it('fails a copy that cannot answer a recovery question', async () => {
    const { sayRehearsal } = await import('../../src/services/institution/keeping.js');
    const said = sayRehearsal({ copy: 'x', opened: true, because: null, bytes: 1, tables: 3, founders: 1,
      liabilities: [{ what: 'what buyers are owed', live: 2, inTheCopy: null, same: false, because: 'no such column' }] });
    expect(said.ok).toBe(false);
    expect(said.lines.join('\n')).toMatch(/could not answer: what buyers are owed/);
  });

  it('reports a difference from the live database without failing on it', async () => {
    // Anything written since the copy was taken is a difference, and a
    // rehearsal that failed on every one would be an alarm nobody reads.
    const { sayRehearsal } = await import('../../src/services/institution/keeping.js');
    const said = sayRehearsal({ copy: 'x', opened: true, because: null, bytes: 1, tables: 3, founders: 1,
      liabilities: [{ what: 'money taken from buyers', live: 2800, inTheCopy: 1400, same: false }] });
    expect(said.ok).toBe(true);
    expect(said.lines.join('\n')).toMatch(/money taken from buyers: 1400 in the copy, 2800 now/);
  });
});
