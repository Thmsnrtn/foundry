process.env.ENCRYPTION_KEY = '0'.repeat(64);
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// =============================================================================
// KEEPING A COPY OF EVERYTHING.
//
// The whole institution is one SQLite file on one volume attached to one
// machine — what he owns, what he has said, what Foundry may and may not do,
// every observation and every reason. Ninety-five routines ran every day and
// not one of them copied it. The written recovery plan described a hosted
// database this deployment does not use, which is worse than no plan: it reads
// like an answer, and would be found to be fiction at the only moment it
// mattered.
// =============================================================================

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'foundry-keep-'));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, 'foundry.db')}`;
  // THE DIRECTORY IS SETUP, NOT AN ASSERTION. Three of the tests below write a
  // file into `backups/` before calling anything, and relied on the FIRST test
  // having created it. When that one timed out on a CI runner the other three
  // failed on ENOENT — one slow test reported as four broken ones, and the
  // real cause four screens up. Creating it here costs nothing and proves
  // nothing either way: what the first test asserts is that a real, openable
  // copy lands in it.
  await mkdir(join(dir, 'backups'), { recursive: true });
});

describe('the daily copy', () => {
  it('writes a real, openable database rather than a claim', async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    const { query } = await import('../../src/db/client.js');
    await runMigrations();
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      ['keep_owner', 'clerk_keep', 'owner@example.com', 'Thomas Norton']);

    const { copyTheInstitution } = await import('../../src/services/institution/keeping.js');
    const kept = await copyTheInstitution();
    expect(kept.skipped).toBeNull();
    expect(kept.bytes).toBeGreaterThan(0);

    // Openable, and it actually contains the institution — a copy nobody has
    // read back is a belief, not a backup.
    const { createClient } = await import('@libsql/client');
    const copy = createClient({ url: `file:${kept.wrote}` });
    const row = (await copy.execute('SELECT name FROM founders')).rows[0] as
      Record<string, unknown>;
    expect(String(row.name)).toBe('Thomas Norton');
    const tables = await copy.execute(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'");
    expect(Number((tables.rows[0] as Record<string, unknown>).n)).toBeGreaterThan(100);
    // A MINUTE, BECAUSE THE WORK IS THE POINT. This applies three hundred and
    // fifty migrations to a real file on disk and then VACUUMs the result into
    // a second one — that is what makes the copy worth believing, and it is
    // not something a mock could stand in for. It took 7.5s here against a
    // 10s default, which is a twenty-five per cent margin on a machine nobody
    // else is using; on a shared runner it went over and took three other
    // tests down with it. The timeout now describes the work rather than
    // hoping the work stays small.
  }, 60_000);

  it('ages out old copies so the volume is not filled by them', async () => {
    const backups = join(dir, 'backups');
    const old = join(backups, 'foundry-2020-01-01.db');
    await writeFile(old, 'not really a database');
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await utimes(old, longAgo, longAgo);

    const { copyTheInstitution } = await import('../../src/services/institution/keeping.js');
    const kept = await copyTheInstitution();
    expect(kept.removed).toBe(1);
    expect((await readdir(backups)).includes('foundry-2020-01-01.db')).toBe(false);
  });

  it('keeps a recent one', async () => {
    const backups = join(dir, 'backups');
    const recent = join(backups, 'foundry-2099-01-01.db');
    await writeFile(recent, 'recent');
    const { copyTheInstitution } = await import('../../src/services/institution/keeping.js');
    await copyTheInstitution();
    expect((await stat(recent)).size).toBeGreaterThan(0);
  });

  it('says so plainly when there is no file to copy', async () => {
    // Better than a backup that silently does nothing on a hosted database.
    const before = process.env.TURSO_DATABASE_URL;
    process.env.TURSO_DATABASE_URL = 'libsql://somewhere.turso.io';
    const { copyTheInstitution } = await import('../../src/services/institution/keeping.js');
    const kept = await copyTheInstitution();
    expect(kept.skipped).toContain('not a file');
    expect(kept.wrote).toBe('');
    process.env.TURSO_DATABASE_URL = before;
  });

  it('can say what would be there if today went wrong', async () => {
    const { whatIsKept } = await import('../../src/services/institution/keeping.js');
    const kept = await whatIsKept();
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0]?.bytes).toBeGreaterThan(0);
  });
});
