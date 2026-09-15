process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { absenceReading } from '../../src/services/institution/absence-test.js';

// =============================================================================
// A GRAVESTONE REPORTED AS A FIRE.
//
// `job_health` is keyed by job name and says nothing about whether anybody
// still schedules that name. That was harmless while every name in it was live.
// The day twenty-seven loops were retired it stopped being harmless: their rows
// stayed, and the absence reading — whose whole job is to say whether silence
// would be mistaken for calm — read one of them and told the owner that
// `behavioral_triggers` had failed fifty times in a row, on an institution that
// had already stopped scheduling it.
//
// Honest about the row and wrong about the world, which is the worst of both.
// He is sent to fix something that does not exist, and the next TRUE finding in
// the same list reads like more of the same — which is how a list that must be
// read line by line stops being read at all.
//
// THE ROW IS NOT DELETED. Fifty failures and a last success on 1 September are
// the history of a real thing that really broke, and a retirement that erases
// the evidence for a decision is how the reason for it gets lost.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const F = 'gv_founder';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'gv_c','gv@test.local')", [F]);
});

beforeEach(async () => { await query('DELETE FROM job_health'); });

async function brokenLoop(name: string, retired: boolean): Promise<void> {
  await query(
    `INSERT INTO job_health (job_name, last_success_at, last_failure_at,
       consecutive_failures, retired_at)
     VALUES (?, datetime('now','-14 day'), datetime('now','-1 hour'), 50, ?)`,
    [name, retired ? new Date().toISOString() : null]);
}

const findings = async (): Promise<string[]> =>
  ((await absenceReading(F, 30)).properties.find((p) => p.property === 'truthful')?.evidence ?? []);

describe('the reading only reports routines something still schedules', () => {
  it('names a live routine that has stopped working', async () => {
    await brokenLoop('a_live_routine', false);
    // Rendered the way he reads it: underscores are not a name.
    expect((await findings()).join(' ')).toContain('a live routine');
  });

  it('says nothing about a retired one, however badly it ended', async () => {
    // THE DEFECT, EXACTLY. Same fifty failures, same silence, same row — and
    // nobody runs it, so there is nothing for him to do about it.
    await brokenLoop('a_retired_routine', true);
    expect((await findings()).join(' ')).not.toContain('a retired routine');
  });

  it('keeps the history rather than erasing it', async () => {
    await brokenLoop('a_retired_routine', true);
    const row = (await query(
      'SELECT consecutive_failures, last_success_at FROM job_health WHERE job_name = ?',
      ['a_retired_routine'])).rows[0] as Record<string, unknown>;
    expect(Number(row.consecutive_failures)).toBe(50);
    expect(row.last_success_at).not.toBeNull();
  });

  it('still fails the property when a live routine is broken beside a retired one', async () => {
    // A retired row must not mask a real one either. The filter narrows what is
    // reported, never whether the property holds.
    await brokenLoop('a_retired_routine', true);
    await brokenLoop('a_live_routine', false);
    const truthful = (await absenceReading(F, 30)).properties.find((p) => p.property === 'truthful');
    expect(truthful?.finding).toBe('DOES_NOT_HOLD');
    expect(truthful?.evidence.join(' ')).toContain('a live routine');
    expect(truthful?.evidence.join(' ')).not.toContain('a retired routine');
  });
});

describe('what is scheduled is derived, never maintained', () => {
  it('stamps from the registry itself, so there is no second list to keep true', () => {
    // A hand-kept list of retired names would be wrong the first time somebody
    // removed a job without remembering it. The composition root reads the
    // registry it is about to schedule from.
    const boot = readFileSync(resolve(ROOT, 'src/index.ts'), 'utf8');
    const fn = boot.slice(boot.indexOf('async function recordWhatIsScheduled'),
      boot.indexOf('function startScheduler'));
    expect(fn).toContain('Object.keys(JOB_REGISTRY)');
    expect(fn).toContain('job_name NOT IN');
    // And clears it again, so a loop that comes back is live by the act of
    // being scheduled.
    expect(fn).toContain('SET retired_at = NULL');
    // COALESCE, so re-stamping does not keep moving the date somebody stopped.
    expect(fn).toContain('COALESCE(retired_at, CURRENT_TIMESTAMP)');
  });

  it('never lets the annotation stop the institution from starting', () => {
    // An institution that will not boot because it could not annotate a health
    // table is worse than one whose annotation is a day stale.
    const boot = readFileSync(resolve(ROOT, 'src/index.ts'), 'utf8');
    expect(boot).toMatch(/void recordWhatIsScheduled\(\)\.catch\(/);
  });
});
