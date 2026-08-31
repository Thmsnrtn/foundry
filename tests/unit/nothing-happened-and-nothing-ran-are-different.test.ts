process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getFailingInstitutionLoops, recordJobFailure, recordJobSuccess,
} from '../../src/services/institution/loop-health.js';

// =============================================================================
// "NOTHING HAPPENED" AND "NOTHING RAN" ARE DIFFERENT FACTS.
//
// Every scheduled job is wrapped in a try/catch that logs and moves on, and
// nothing durable recorded that it failed. A week in which the effect
// reconciliation threw on every run looked exactly like a calm week on the page
// the founder reads: no new outcomes, no new judgments, nothing visibly wrong.
//
// The founder is reading a page whose freshness depends on loops they cannot
// see. Telling them afterwards is telling them once they have already decided,
// so the notice is rendered above everything else.
//
// THE ERROR'S CLASS NAME IS KEPT, NEVER ITS MESSAGE. A message carries whatever
// the failure was carrying — a customer address, a provider response, part of a
// secret — and a health table is the last place that belongs. The founder is
// not shown even the class name: what went wrong is Foundry's problem, and what
// they need is which of their things is not being kept current.
// =============================================================================

const P = 'lh_product';
const OWNER = 'lh_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'lh_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

beforeEach(async () => { await query('DELETE FROM job_health'); });

const page = async (): Promise<string> => (await app.request('/letter')).text();

describe('an institution loop that is failing', () => {
  it('is said on the letter, above everything it makes stale', async () => {
    expect(await page()).not.toContain('Part of me has stopped');

    await recordJobFailure('institutional_effect_reconciliation', new TypeError('boom at jo@fieldstone.example'));
    await recordJobFailure('institutional_effect_reconciliation', new TypeError('boom again'));

    const failing = await getFailingInstitutionLoops();
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({
      consecutiveFailures: 2, lastErrorName: 'TypeError', stoppedRunning: false });

    const html = await page();
    expect(html).toContain('Part of me has stopped');
    expect(html).toContain('failed 2 times in a row');
    expect(html).toContain('may be out of date');
    // THE FIRST CARD ON THE PAGE. Telling a founder afterwards is telling them
    // once they have already decided, so this is asserted as a position and not
    // merely as presence.
    const firstCard = html.indexOf('<div class="card"');
    const notice = html.indexOf('Part of me has stopped');
    expect(firstCard).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(firstCard);
    expect(html.indexOf('<div class="card"', notice)).toBeGreaterThan(notice);
    // Nothing else opened a card before it: the first card IS this one.
    expect(html.slice(firstCard + 1, notice)).not.toContain('<div class="card"');
    // Never the founder's problem to debug.
    expect(html).not.toContain('TypeError');
    expect(html).not.toContain('fieldstone');
  });

  it('stops saying it the moment the loop works again', async () => {
    await recordJobFailure('institutional_judgment_tick', new Error('x'));
    expect(await page()).toContain('Part of me has stopped');
    await recordJobSuccess('institutional_judgment_tick');
    expect(await getFailingInstitutionLoops()).toEqual([]);
    expect(await page()).not.toContain('Part of me has stopped');
  });

  it('keeps a failure message out of the record, in the database', async () => {
    await recordJobFailure('institutional_judgment_tick', new Error('x'));
    await expect(query(
      "UPDATE job_health SET last_error_name='connection refused talking to jo@fieldstone.example' WHERE job_name=?",
      ['institutional_judgment_tick'])).rejects.toThrow(/error_name_is_not_a_message/);
  });

  it('notices a loop that stopped running rather than started failing', async () => {
    // The likelier production failure: a scheduler that never started, a
    // process group serving HTTP without crons, a cron expression that never
    // matches. Nothing throws. Silence looks exactly like calm.
    await recordJobSuccess('institutional_effect_reconciliation');
    expect(await getFailingInstitutionLoops()).toEqual([]);
    await query(
      "UPDATE job_health SET last_success_at=datetime('now','-9 hours') WHERE job_name=?",
      ['institutional_effect_reconciliation']);

    const stopped = await getFailingInstitutionLoops();
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatchObject({ stoppedRunning: true, consecutiveFailures: 0 });
    expect(await page()).toContain('has not run when it should have');
  });

  it('never tells a company that has just arrived that Foundry has stopped', async () => {
    // Nothing has run yet because nothing has had a first tick. Reading
    // staleness out of that silence would greet every new company with a
    // failure notice.
    expect(await getFailingInstitutionLoops()).toEqual([]);
    expect(await page()).not.toContain('Part of me has stopped');
  });

  it('names only jobs that exist, so the map cannot drift from the registry', async () => {
    const { INSTITUTION_LOOPS } = await import('../../src/services/institution/loop-health.js');
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    // This map named `external_metric_shadow_resolution`, which is not a job —
    // that work happens inside the judgment tick. A loop-health list that names
    // work nobody schedules is the same fiction it exists to catch.
    for (const name of Object.keys(INSTITUTION_LOOPS)) {
      expect(JOB_REGISTRY[name], `${name} is not a scheduled job`).toBeTruthy();
    }
  });

  it('is recorded by the scheduler itself, not only by this test', () => {
    const index = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf8');
    expect(index).toContain('recordJobFailure');
    expect(index).toContain('recordJobSuccess');
  });
});
