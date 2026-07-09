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

const MIGRATIONS_DIR = resolve(__dirname, '../../src/db/migrations');
let db: ReturnType<typeof createClient>;

// Mirror of acquireJobLock's SQL, parameterized by instanceId (production hard-
// codes one INSTANCE_ID per process; a single-process test needs distinct ids).
async function acquireAs(instanceId: string, jobName: string, ttlSeconds = 300): Promise<boolean> {
  await db.execute({
    sql: `INSERT INTO job_locks (job_name, locked_at, locked_by, expires_at)
          VALUES (?, datetime('now'), ?, datetime('now', ?))
          ON CONFLICT(job_name) DO UPDATE SET
            locked_at = datetime('now'),
            locked_by = excluded.locked_by,
            expires_at = excluded.expires_at
          WHERE job_locks.expires_at < datetime('now')`,
    args: [jobName, instanceId, `+${ttlSeconds} seconds`],
  });
  const r = await db.execute({ sql: 'SELECT locked_by FROM job_locks WHERE job_name = ?', args: [jobName] });
  return (r.rows[0] as Record<string, unknown>)?.locked_by === instanceId;
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
});
