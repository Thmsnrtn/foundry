// =============================================================================
// LAW (Roadmap 2027 R33a): A DEPLOY DOES NOT COST A DAY.
//
// The daily economic jobs run at fixed minutes; a restart across one of them
// skipped it until the next day. On boot the scheduler now runs, once, each
// daily job whose last minute passed with nothing recorded since, through the
// same locked, recorded door a tick uses. A failure is a result and is not
// re-run; a job that never ran waits for its schedule; and the catch-up waits
// out the job lock so a run cut off by the restart is not doubled.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'd'.repeat(64);

import { readFileSync } from 'fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { CATCH_UP_DELAY_SECONDS, jobsThatMissedTheirMinute, lastDailyTickBefore, missedItsMinute } from '../../src/services/institution/catch-up.js';

const at = (iso: string) => new Date(iso);

describe('which minute a daily job last fell on', () => {
  it('reads only daily schedules, in UTC', () => {
    expect(lastDailyTickBefore('15 5 * * *', at('2026-10-05T06:55:00Z'))?.toISOString()).toBe('2026-10-05T05:15:00.000Z');
    expect(lastDailyTickBefore('15 5 * * *', at('2026-10-05T04:00:00Z'))?.toISOString()).toBe('2026-10-04T05:15:00.000Z');
    expect(lastDailyTickBefore('0 9 * * 1', at('2026-10-05T10:00:00Z'))).toBeNull();
    expect(lastDailyTickBefore('*/15 * * * *', at('2026-10-05T10:00:00Z'))).toBeNull();
  });
});

describe('what counts as missed', () => {
  const now = at('2026-10-05T06:55:00Z');
  it('a job that last succeeded yesterday and whose 05:15 passed during a restart missed it', () => {
    expect(missedItsMinute({ schedule: '15 5 * * *', now, lastSuccessAt: at('2026-10-04T05:16:00Z'), lastFailureAt: null })?.toISOString())
      .toBe('2026-10-05T05:15:00.000Z');
  });
  it('one that ran at its minute did not', () => {
    expect(missedItsMinute({ schedule: '15 5 * * *', now, lastSuccessAt: at('2026-10-05T05:16:00Z'), lastFailureAt: null })).toBeNull();
  });
  it('one that failed at its minute is a result, not a miss, and is not re-run', () => {
    expect(missedItsMinute({ schedule: '15 5 * * *', now, lastSuccessAt: at('2026-10-04T05:16:00Z'), lastFailureAt: at('2026-10-05T05:15:30Z') })).toBeNull();
  });
  it('one that has never run waits for its own schedule', () => {
    expect(missedItsMinute({ schedule: '15 5 * * *', now, lastSuccessAt: null, lastFailureAt: null })).toBeNull();
  });
});

describe('read from the health table, for the registry', () => {
  beforeAll(async () => {
    await runMigrations();
    await query(`INSERT INTO job_health (job_name, last_success_at, consecutive_failures, updated_at) VALUES
      ('forge_daily', datetime('now', '-30 hours'), 0, datetime('now')),
      ('ran_fine', datetime('now', '-1 minutes'), 0, datetime('now'))`, []);
  });
  it('names the daily job whose last minute passed unrun, and not the one that ran or the weekly one', async () => {
    const now = new Date();
    const hm = new Date(now.getTime() - 2 * 3_600_000);
    const daily = `${String(hm.getUTCMinutes())} ${String(hm.getUTCHours())} * * *`;
    const missed = await jobsThatMissedTheirMinute({
      forge_daily: { schedule: daily }, ran_fine: { schedule: daily }, weekly: { schedule: '0 9 * * 1' }, brand_new: { schedule: daily },
    }, now);
    expect(missed.map((m) => m.name)).toEqual(['forge_daily']);
  });
});

describe('the catch-up goes through the same door as a tick, after the lock\'s life', () => {
  it('waits longer than the job lock lives', () => {
    const lock = readFileSync('src/services/job-lock.ts', 'utf8');
    const ttl = Number(/ttlSeconds: number = (\d+)/.exec(lock)?.[1]);
    expect(ttl).toBeGreaterThan(0);
    expect(CATCH_UP_DELAY_SECONDS).toBeGreaterThan(ttl);
  });
  it('the scheduler runs a caught-up job through runScheduledJob, which locks and records it', () => {
    const src = readFileSync('src/index.ts', 'utf8');
    expect(src).toMatch(/new CronJob\(job\.schedule, async \(\) => \{ await runScheduledJob\(name, job\.fn\); \}/);
    expect(src).toMatch(/jobsThatMissedTheirMinute\(JOB_REGISTRY\)[\s\S]{0,400}await runScheduledJob\(m\.name/);
    const runner = /async function runScheduledJob[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(runner).toContain('acquireJobLock(name)');
    expect(runner).toContain('recordJobSuccess(name)');
    expect(runner).toContain('releaseJobLock(name)');
  });
});
