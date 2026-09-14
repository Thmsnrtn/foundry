process.env.ENCRYPTION_KEY = '0'.repeat(64);
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { worthKeeping } from '../../src/services/institution/keeping.js';
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
    // read back is a belief, not a backup. The copy is compressed now, so
    // "openable" has to go through the restore path, which is the honest
    // version of the question anyway: a copy you cannot restore is not one.
    const { restoreTheInstitution } = await import('../../src/services/institution/keeping.js');
    const back = await restoreTheInstitution(kept.wrote, join(dir, 'readback.db'));
    expect(back.tables).toBeGreaterThan(100);
    const { createClient } = await import('@libsql/client');
    const copy = createClient({ url: `file:${join(dir, 'readback.db')}` });
    const row = (await copy.execute('SELECT name FROM founders')).rows[0] as
      Record<string, unknown>;
    expect(String(row.name)).toBe('Thomas Norton');
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

describe('the ladder, and the restore that makes it a claim worth making', () => {
  const NOW = new Date('2026-09-14T04:15:00Z');

  it('keeps every copy inside the fourteen-day window', () => {
    for (const d of ['2026-09-14', '2026-09-10', '2026-09-01']) {
      expect(worthKeeping(`foundry-${d}.db.gz`, NOW)).toBe(true);
    }
  });

  it('keeps Mondays for three months and drops the days between', () => {
    // 2026-08-03 is a Monday, 42 days back. 2026-08-05 is the Wednesday after.
    expect(worthKeeping('foundry-2026-08-03.db.gz', NOW)).toBe(true);
    expect(worthKeeping('foundry-2026-08-05.db.gz', NOW)).toBe(false);
  });

  it('keeps the first of the month for a year, after the Mondays have gone', () => {
    // 2026-01-01 is 256 days back: outside 14 days and outside 12 weeks.
    expect(worthKeeping('foundry-2026-01-01.db.gz', NOW)).toBe(true);
    expect(worthKeeping('foundry-2026-01-02.db.gz', NOW)).toBe(false);
  });

  it('drops what is past every rung', () => {
    // Older than a year, and not a first: nothing keeps it.
    expect(worthKeeping('foundry-2024-06-13.db.gz', NOW)).toBe(false);
  });

  it('thins by the date in the NAME, not the file mtime', () => {
    // A restore or a volume move touches every file at once. Thinning by mtime
    // would then keep ninety copies of one afternoon and call it a year.
    expect(worthKeeping('foundry-2024-06-13.db.gz', NOW)).toBe(false);
    expect(worthKeeping('foundry-2024-06-13.db', NOW)).toBe(false);
  });

  it('never deletes a file whose name it does not understand', () => {
    // This function deletes things, so the unknown case errs towards keeping.
    expect(worthKeeping('pre-deploy-river-port-from-437505b0.db', NOW)).toBe(true);
    expect(worthKeeping('something-somebody-put-here.db', NOW)).toBe(true);
  });

  it('RESTORES a real copy and finds the institution inside it', async () => {
    // THE EVIDENCE THE HORIZON RESTS ON. "Is there a file" is the easy
    // question; this is the one that matters, and until it passed the
    // institution was not entitled to claim any recovery horizon at all.
    const { copyTheInstitution, restoreTheInstitution } =
      await import('../../src/services/institution/keeping.js');
    // The copy THIS call wrote, not whatever sorts first in the directory —
    // the tests above deliberately leave two files there that are not
    // databases at all, and a restore test that picks one of those is testing
    // the fixture.
    const made = await copyTheInstitution();
    expect(made.wrote).toMatch(/\.db\.gz$/);
    const back = await restoreTheInstitution(made.wrote, join(dir, 'restored.db'));
    expect(back.bytes).toBeGreaterThan(0);
    expect(back.tables).toBeGreaterThan(100);
    // The founder written at the top of this file came back out of the copy.
    expect(back.founders).toBeGreaterThan(0);
  }, 60_000);

  it('refuses to restore over the live database', async () => {
    const { restoreTheInstitution } = await import('../../src/services/institution/keeping.js');
    await expect(restoreTheInstitution(join(dir, 'backups', 'anything.db.gz'),
      join(dir, 'foundry.db'))).rejects.toThrow(/will_not_restore_over_the_live_database/);
  });
});
