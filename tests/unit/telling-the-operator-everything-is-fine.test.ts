process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAutomationHealth, getPulse } from '../../src/services/founder/intelligence.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// FOUNDRY TELLING ITS OWN OPERATOR THAT EVERYTHING IS FINE, FROM A CONSTANT.
//
// `getAutomationHealth` returned `total_jobs: 30, jobs_healthy: 30,
// jobs_degraded: 0, jobs_failed: 0`, and `getPulse` returned
// `{ healthy: 30, degraded: 0, failed: 0 }` under the comment "From job
// registry". Neither read anything. The registry has NINETY jobs.
//
// The data was there the whole time. Migration 172 gave the loops a way to say
// when they stop, `src/index.ts` records success and failure around EVERY
// registry job, and the founder's Letter already renders the failing ones.
//
// So the founder was told the truth and the OPERATOR — the person who would
// actually fix a broken job — was told a constant. That inverts the usual
// severity of this defect class: the surface that exists to catch problems was
// the one guaranteed never to show any.
//
// `degraded` is gone rather than computed. It was an invented middle category
// with no definition behind it; what replaces it is the honest bucket, NEVER
// REPORTED, which is not the same fact as healthy.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await query('DELETE FROM job_health'); });

const registrySize = Object.keys(JOB_REGISTRY).length;

describe('what the operator is told about the scheduler', () => {
  it('counts the jobs that exist, not a number written in the source', async () => {
    const health = await getAutomationHealth();
    expect(health.total_jobs).toBe(registrySize);
    expect(health.total_jobs, 'the constant was 30').not.toBe(30);
  });

  it('says nothing is healthy before anything has reported', async () => {
    const health = await getAutomationHealth();
    expect(health.jobs_never_reported, 'never observed is not healthy').toBe(registrySize);
    expect(health.jobs_healthy).toBe(0);
    expect(health.jobs_failing).toBe(0);
  });

  it('shows a failing job as failing', async () => {
    const [name] = Object.keys(JOB_REGISTRY);
    await query(
      `INSERT INTO job_health (job_name, last_failure_at, consecutive_failures, last_error_name)
       VALUES (?, datetime('now'), 3, 'Error')`, [name]);

    const health = await getAutomationHealth();
    expect(health.jobs_failing, 'the number an operator would act on').toBe(1);
    expect(health.jobs_never_reported).toBe(registrySize - 1);
    expect(health.jobs_healthy).toBe(0);
  });

  it('shows a recovered job as healthy again', async () => {
    const [name] = Object.keys(JOB_REGISTRY);
    await query(
      `INSERT INTO job_health (job_name, last_success_at, consecutive_failures)
       VALUES (?, datetime('now'), 0)`, [name]);

    const health = await getAutomationHealth();
    expect(health.jobs_healthy).toBe(1);
    expect(health.jobs_failing).toBe(0);
  });

  it('does not count a health row for a job the registry no longer has', async () => {
    await query(
      `INSERT INTO job_health (job_name, last_failure_at, consecutive_failures, last_error_name)
       VALUES ('a_job_that_was_deleted', datetime('now'), 5, 'Error')`);
    const health = await getAutomationHealth();
    expect(health.jobs_failing, 'the registry is what exists').toBe(0);
    expect(health.total_jobs).toBe(registrySize);
  });
});

describe('the pulse and the automation panel', () => {
  it('agree, because they count in one place', async () => {
    const [name] = Object.keys(JOB_REGISTRY);
    await query(
      `INSERT INTO job_health (job_name, last_failure_at, consecutive_failures, last_error_name)
       VALUES (?, datetime('now'), 2, 'Error')`, [name]);

    const [pulse, automation] = await Promise.all([getPulse(), getAutomationHealth()]);
    expect(pulse.job_health.failed, 'the same count, from the same function')
      .toBe(automation.jobs_failing);
    expect(pulse.job_health.healthy).toBe(automation.jobs_healthy);
    expect(pulse.job_health.degraded).toBe(automation.jobs_never_reported);
  });

  it('hold no hardcoded job counts in the source', () => {
    // Comments quote the old constants on purpose.
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src, 'a job count written into the source is a claim nobody measured')
      .not.toMatch(/healthy:\s*30|total_jobs:\s*30|jobs_healthy:\s*30/);
  });
});
