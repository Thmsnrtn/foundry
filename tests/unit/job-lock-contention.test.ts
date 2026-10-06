// =============================================================================
// Tests: distributed job-lock contention (Roadmap 3.1 — web/worker split)
//
// The whole safety of moving 75 crons onto a dedicated worker rests on one
// property: during a rolling deploy two workers overlap, and every job must run
// AT MOST ONCE. These deterministic assertions guard that property; the load
// harness (tests/load/cron-load.ts) additionally checks it under volume + timing.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { splitSqlStatements } from '../../src/db/migrate.js';
import { ACQUIRE_JOB_LOCK_SQL } from '../../src/services/job-lock.js';

const MIGRATIONS_DIR = resolve(__dirname, '../../src/db/migrations');
let db: ReturnType<typeof createClient>;

// The production acquire SQL, run against a private in-memory DB with the lease
// token supplied, so one test can play many distinct acquisitions. Ownership is
// per acquisition token, so two runs in ONE process are as distinct as two
// workers — a single-process re-entry is just another token.
async function acquireAs(token: string, jobName: string, ttlSeconds = 300): Promise<boolean> {
  await db.execute({ sql: ACQUIRE_JOB_LOCK_SQL, args: [jobName, token, `+${ttlSeconds} seconds`] });
  const r = await db.execute({ sql: 'SELECT locked_by FROM job_locks WHERE job_name = ?', args: [jobName] });
  return (r.rows[0] as Record<string, unknown>)?.locked_by === token;
}

beforeAll(async () => {
  db = createClient({ url: 'file::memory:' });
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of splitSqlStatements(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf-8'))) {
      await db.execute({ sql: stmt, args: [] }).catch(() => {});
    }
  }
});

beforeEach(async () => {
  await db.execute({ sql: 'DELETE FROM job_locks', args: [] });
});

describe('job-lock contention', () => {
  it('lets exactly one of many racing instances win the same job', async () => {
    const instances = Array.from({ length: 16 }, (_, i) => `inst-${i}`);
    const results = await Promise.all(instances.map((id) => acquireAs(id, 'lifecycle_check')));
    expect(results.filter(Boolean).length).toBe(1);
  });

  it('blocks every other instance while the lock is held', async () => {
    expect(await acquireAs('A', 'metric_snapshot')).toBe(true);
    expect(await acquireAs('B', 'metric_snapshot')).toBe(false);
    expect(await acquireAs('C', 'metric_snapshot')).toBe(false);
  });

  it('keeps distinct jobs independent (no cross-job contention)', async () => {
    expect(await acquireAs('A', 'job_x')).toBe(true);
    expect(await acquireAs('B', 'job_y')).toBe(true); // different job → not blocked
  });

  it('reclaims an expired lease from a crashed worker (no permanent deadlock)', async () => {
    expect(await acquireAs('crashed', 'red_daily')).toBe(true);
    await db.execute({
      sql: "UPDATE job_locks SET expires_at = datetime('now','-1 seconds') WHERE job_name = 'red_daily'",
      args: [],
    });
    expect(await acquireAs('healthy', 'red_daily')).toBe(true);
  });

  it('refuses a second acquisition by the same process while the first holds it, and only the holder releases', async () => {
    // Two runs in one process carry two tokens with the same instance prefix.
    expect(await acquireAs('procA:run1', 'slo_check')).toBe(true);
    expect(await acquireAs('procA:run2', 'slo_check')).toBe(false);
    // The refused run's release must not delete the holder's lease.
    await db.execute({ sql: 'DELETE FROM job_locks WHERE job_name = ? AND locked_by = ?', args: ['slo_check', 'procA:run2'] });
    const r = await db.execute({ sql: 'SELECT locked_by FROM job_locks WHERE job_name = ?', args: ['slo_check'] });
    expect((r.rows[0] as Record<string, unknown>)?.locked_by).toBe('procA:run1');
  });
});
