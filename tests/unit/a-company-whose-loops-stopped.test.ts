process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  INSTITUTION_LOOPS, getFailingInstitutionLoops, getFailingLoopsForCompany,
  recordCompanyLoopOutcome, recordJobFailure, recordJobSuccess,
} from '../../src/services/institution/loop-health.js';
import { getStepAwayHorizon } from '../../src/services/institution/absence-summary.js';

// =============================================================================
// A COMPANY WHOSE LOOPS STOPPED, IN A TICK THAT SUCCEEDED.
//
// The institution's loops run per company, and each company's slice is wrapped
// so that "one product's institutional state must never stop another's pass."
// Those handlers log and continue, so the JOB resolves and `recordJobSuccess`
// writes a fresh `last_success_at`.
//
// So a company whose judgment pass throws on every run reads a page saying
// nothing has stopped — the exact defect the loops-stopped card exists for,
// fixed once at the job level and still true one level down.
//
// Worse than recording nothing: `stoppedRunning` needs `last_success_at` to go
// stale, and the successful run refreshes it every time, so the branch that
// would eventually have noticed can never fire.
// =============================================================================

const P = 'clh_product';
const OTHER = 'clh_other';
const OWNER = 'clh_owner';
const LOOP = 'institutional_judgment_tick';

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM company_loop_health');
  await query('DELETE FROM job_health');
  await query('DELETE FROM products WHERE id IN (?,?)', [P, OTHER]);
  await query('DELETE FROM founders WHERE id=?', [OWNER]);
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [OWNER, 'clh_c', 'o@test.local']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?),(?,?,?)',
    [P, 'Stopped Co', OWNER, OTHER, 'Fine Co', OWNER]);
});

describe('a slice that failed inside a run that succeeded', () => {
  it('is invisible to the job-level question, which is the whole problem', async () => {
    // The job did succeed: every other company's slice worked.
    await recordJobSuccess(LOOP);
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));

    expect(await getFailingInstitutionLoops()).toEqual([]);
    const forCompany = await getFailingLoopsForCompany(P);
    expect(forCompany.map((l) => l.jobName)).toEqual([LOOP]);
    expect(forCompany[0].consecutiveFailures).toBe(1);
    expect(forCompany[0].label).toBe(INSTITUTION_LOOPS[LOOP].label);
  });

  it('says nothing about a company whose slice worked in the same run', async () => {
    await recordJobSuccess(LOOP);
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));
    await recordCompanyLoopOutcome(OTHER, LOOP, null);
    expect(await getFailingLoopsForCompany(OTHER)).toEqual([]);
  });

  it('counts consecutive failures, and a run that works clears them', async () => {
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));
    expect((await getFailingLoopsForCompany(P))[0].consecutiveFailures).toBe(2);

    // A company that recovers must not stay marked as failing for good.
    await recordCompanyLoopOutcome(P, LOOP, null);
    expect(await getFailingLoopsForCompany(P)).toEqual([]);
  });

  it('keeps a class name and refuses a message in its place', async () => {
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));
    expect((await getFailingLoopsForCompany(P))[0].lastErrorName).toBe('TypeError');

    // A message can carry a customer's words into a table not classified to
    // hold them. The database refuses it independently of the recorder.
    await expect(query(
      `INSERT INTO company_loop_health (product_id,job_name,last_error_name,consecutive_failures)
       VALUES (?, 'x', 'this is a whole sentence', 1)`, [P],
    )).rejects.toThrow(/error_name_is_not_a_message/);
  });
});

describe('one answer per loop', () => {
  it('never lets a company-specific failure make a global one look milder', async () => {
    await recordJobFailure(LOOP, new RangeError('global'));
    await recordJobFailure(LOOP, new RangeError('global'));
    await recordJobFailure(LOOP, new RangeError('global'));
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('local'));

    const merged = await getFailingLoopsForCompany(P);
    expect(merged).toHaveLength(1);
    expect(merged[0].consecutiveFailures).toBe(3);
  });

  it('takes the company count when it is the worse one', async () => {
    await recordJobFailure(LOOP, new RangeError('global'));
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('local'));
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('local'));

    const merged = await getFailingLoopsForCompany(P);
    expect(merged).toHaveLength(1);
    expect(merged[0].consecutiveFailures).toBe(2);
  });

  it('does not claim a company slice stopped running, which it cannot see', async () => {
    // Absence of a row is a fresh company as much as a stopped one, and
    // claiming staleness from silence is the mistake the job-level reader
    // refuses to make.
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));
    expect((await getFailingLoopsForCompany(P))[0].stoppedRunning).toBe(false);
  });
});

describe('the caveat the founder reads', () => {
  it('says some of what would notice a problem is not running', async () => {
    await recordJobSuccess(LOOP);
    await recordCompanyLoopOutcome(P, LOOP, new TypeError('boom'));
    expect((await getStepAwayHorizon(P)).loopsStopped).toBe(1);
    // And not for the company whose slice was fine.
    expect((await getStepAwayHorizon(OTHER)).loopsStopped).toBe(0);
  });
});
