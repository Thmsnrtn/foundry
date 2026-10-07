// =============================================================================
// Tests: distributed job-lock contention (Roadmap 3.1 — web/worker split)
//
// The whole safety of moving the crons onto a dedicated worker rests on one
// property: during a rolling deploy two workers overlap, and every job must run
// AT MOST ONCE. These deterministic assertions guard that property; the load
// harness (tests/load/cron-load.ts) additionally checks it under volume + timing.
//
// THE REAL LOCK, NOT A MIRROR OF ITS SQL (remediation 1.1, 6 October 2026).
// This file used to copy acquireJobLock's SQL with an instance id per caller,
// because the real helper keyed ownership on one id per PROCESS — and that is
// exactly why it let a second run of a routine start in the same process: the
// mirror tested the property the real code did not have. Each acquisition now
// carries its own token, so many racing acquisitions in one process are as
// distinct as many workers, and the real functions are what is tested.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { acquireJobLock, releaseJobLock } from '../../src/services/job-lock.js';

const holder = async (job: string) => ((await query('SELECT locked_by FROM job_locks WHERE job_name = ?', [job])).rows[0] as Record<string, unknown> | undefined)?.locked_by ?? null;

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await query('DELETE FROM job_locks', []); });

describe('job-lock contention', () => {
  it('lets exactly one of many racing acquisitions win the same job', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => acquireJobLock('lifecycle_check')));
    expect(results.filter((t) => t !== null).length).toBe(1);
  });

  it('blocks every other acquisition while the lock is held', async () => {
    expect(await acquireJobLock('metric_snapshot')).not.toBeNull();
    expect(await acquireJobLock('metric_snapshot')).toBeNull();
    expect(await acquireJobLock('metric_snapshot')).toBeNull();
  });

  it('keeps distinct jobs independent (no cross-job contention)', async () => {
    expect(await acquireJobLock('job_x')).not.toBeNull();
    expect(await acquireJobLock('job_y')).not.toBeNull(); // different job → not blocked
  });

  it('reclaims an expired lease from a crashed worker (no permanent deadlock)', async () => {
    expect(await acquireJobLock('red_daily')).not.toBeNull();
    await query("UPDATE job_locks SET expires_at = datetime('now','-1 seconds') WHERE job_name = 'red_daily'", []);
    expect(await acquireJobLock('red_daily')).not.toBeNull();
  });
});

describe('inside one process, a run in progress is not run again (remediation 1.1)', () => {
  it('the run already holding the lock is refused a second acquisition, by this same process', async () => {
    const first = await acquireJobLock('forge_tick');
    expect(first).not.toBeNull();
    expect(await acquireJobLock('forge_tick'), 'an overrunning hourly tick, or the boot catch-up, asking again').toBeNull();
  });

  it('the first run\'s lock survives a refused second run, and only its own release ends it', async () => {
    const first = (await acquireJobLock('forge_tick'))!;
    const second = await acquireJobLock('forge_tick');
    expect(second).toBeNull();
    // The release a second run would make with any token but the holder's.
    await releaseJobLock('forge_tick', 'another-run-entirely');
    expect(await holder('forge_tick'), 'nobody else can end the first run\'s hold').toBe(first);
    expect(await acquireJobLock('forge_tick'), 'and it still keeps a third run out').toBeNull();
    await releaseJobLock('forge_tick', first);
    expect(await holder('forge_tick')).toBeNull();
    expect(await acquireJobLock('forge_tick'), 'released by its own holder, the routine is free').not.toBeNull();
  });

  it('a run whose lease expired and was taken cannot release the new holder', async () => {
    const stale = (await acquireJobLock('slo_check'))!;
    await query("UPDATE job_locks SET expires_at = datetime('now','-1 seconds') WHERE job_name = 'slo_check'", []);
    const fresh = (await acquireJobLock('slo_check'))!;
    expect(fresh).not.toBe(stale);
    await releaseJobLock('slo_check', stale);
    expect(await holder('slo_check')).toBe(fresh);
  });
});
