process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { executeRaw, query } from '../../src/db/client.js';
import { recordJobFailure, recordJobSuccess, ECONOMIC_LOOPS, INSTITUTION_LOOPS } from '../../src/services/institution/loop-health.js';
import { howFoundryIsRunning } from '../../src/services/founder/health.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// FOUNDRY KNOWS WHETHER FOUNDRY RAN.
//
// "Foundry has nothing connected to it, so silence from it means nothing." The
// page could say "everything I run is running" with the forge silent for a
// week, because the two loops it watched were about companies he does not yet
// have, and the seven that carry a sentence to a priced offer were watched by
// nothing. "Nothing found" and "nothing looked" were one sentence.
//
// Now the economic loop's routines are named against their own cadence, one
// reading says the first true thing — stopped, blocked, working, or waiting
// because nothing deserves action — Home shows it, the health endpoint carries
// it for whatever probes from outside, and when a routine stops, the owner is
// told once, by the same door billing notices use, and not again.
// =============================================================================

const OWNER = 'pk_owner'; const FOUNDRY = 'pk_foundry';
let app: Hono;
const page = async (path: string) => (await app.request(path)).text();
const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
const reset = async () => { await query('DELETE FROM job_health', []); };
const allRanNow = async () => { for (const j of ECONOMIC_LOOPS) await recordJobSuccess(j); };

beforeAll(async () => {
  await runMigrations();
  for (const m of ['065_idempotency_keys', '066_data_classifications', '067_communication_budgets']) {
    await executeRaw(readFileSync(resolve(__dirname, `../../src/db/migrations/${m}.sql`), 'utf-8'));
  }
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_pk', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'test')`, [FOUNDRY]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the economic loop is named against its own cadence', () => {
  it('every economic routine exists in the registry and its staleness bound exceeds its cadence', () => {
    expect(ECONOMIC_LOOPS.length).toBeGreaterThanOrEqual(7);
    for (const name of ECONOMIC_LOOPS) {
      const job = JOB_REGISTRY[name as keyof typeof JOB_REGISTRY] as { schedule: string } | undefined;
      expect(job, `${name} is watched but not scheduled`).toBeDefined();
      const [minute, hour] = String(job!.schedule).split(' ');
      // A daily routine (fixed hour) must be allowed more than a day; an
      // hourly one (every hour) more than an hour. Otherwise the bound trips
      // on an ordinary day.
      const cadenceHours = hour === '*' ? 1 : 24;
      expect(INSTITUTION_LOOPS[name]!.staleAfterHours, `${name} at ${minute} ${hour}`).toBeGreaterThan(cadenceHours);
    }
  });
});

describe('one sentence, the first true thing', () => {
  it('a fresh institution has nothing to report yet, and says so rather than reading silence as calm', async () => {
    await reset();
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('waiting');
    expect(p.sentence).toBe('Foundry has not completed a scheduled pass yet.');
  });

  it('ran, and there is nothing to look for', async () => {
    await reset(); await allRanNow();
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('waiting');
    expect(p.sentence).toBe('Foundry is working. Nothing is being looked for — no search is open.');
    expect(p.lastPassAt).not.toBeNull();
  });

  it('ran, is looking, and nothing found has earned a candidate', async () => {
    const { openMandate } = await import('../../src/services/venture/mandate.js');
    const m = await openMandate({ founderId: OWNER, statement: 'Small things for shops', shape: null, evidenceMode: 'real' });
    if ('refused' in m) throw new Error(m.refused);
    // A way of looking, so the search is not blocked for want of eyes.
    const { connectResearchSource } = await import('../../src/services/venture/research-sources.js');
    await connectResearchSource({ founderId: OWNER, sourceType: 'directory', named: 'a registry', neverGrants: 'anything', evidenceMode: 'real' });
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('waiting');
    expect(p.word).toBe('Looking');
    expect(p.sentence).toContain('It is looking; nothing found so far has earned a candidate.');
  });

  it('ran, and no opportunity currently deserves a test', async () => {
    const m = (await query(`SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES ('pk_opp',?,?,'a brief','shops','scattered notices','somebody pays','nobody pays','[]','real')`, [String(m.id), OWNER]);
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('waiting');
    expect(p.sentence).toBe('Foundry is working. No opportunity currently deserves a test.');
  });

  it('a test is running', async () => {
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('pk_unk',?,'pk_opp','will anyone pay',1,'ask')`, [OWNER]);
    await query(
      `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
       VALUES ('pk_x',?,'pk_opp','pk_unk','sell a brief','someone pays','nobody pays',2000,'real')`, [OWNER]);
    const designing = await howFoundryIsRunning(OWNER);
    expect(designing.state).toBe('working');
    expect(designing.sentence).toBe('Foundry is working. It is designing a test.');

    const { decideExperiment } = await import('../../src/services/venture/validation.js');
    await decideExperiment({ experimentId: 'pk_x', decision: 'approved', by: `founder:${OWNER}` });
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('working');
    expect(p.sentence).toBe('Foundry is working. 1 test is running.');
  });

  it("hasn't completed its scheduled work: a daily routine that has not run in thirty hours", async () => {
    await query(`UPDATE job_health SET last_success_at = ? WHERE job_name = 'forge_tick'`, [hoursAgo(40)]);
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('stopped');
    expect(p.sentence).toContain("Foundry hasn't completed its scheduled work.");
    expect(p.sentence).toContain('has not run when it should have');
    expect(p.sentence).toContain('its last successful run was yesterday');
    expect(p.stoppedLoop?.jobName).toBe('forge_tick');
    // Stopped outranks working: the running test is stale news until it recovers.
    await recordJobSuccess('forge_tick');
    expect((await howFoundryIsRunning(OWNER)).state).toBe('working');
  });

  it("hasn't completed its scheduled work: an hourly routine failing", async () => {
    for (let i = 0; i < 3; i += 1) await recordJobFailure('experiment_hand_tick', new Error('a provider said no'));
    const p = await howFoundryIsRunning(OWNER);
    expect(p.state).toBe('stopped');
    expect(p.sentence).toContain('has failed 3 times running');
    // Never the message. What went wrong is Foundry's problem; the owner is
    // told which routine and since when.
    expect(p.sentence).not.toContain('a provider said no');
    await recordJobSuccess('experiment_hand_tick');
  });
});

describe('it reaches him', () => {
  it('Home says it in one line, under the first section', async () => {
    const t = await page('/foundry');
    expect(t).toContain('id="pulse"');
    expect(t).toContain('Foundry is working. 1 test is running.');
    expect(t).toContain('Last completed pass');
  });

  it('and "are you okay" gives the same sentence', async () => {
    const t = await page('/foundry?ask=okay');
    expect(t).toContain('Foundry is working. 1 test is running.');
  });

  it('the health endpoint carries the same reading for whatever probes from outside', async () => {
    const { healthRoutes } = await import('../../src/routes/internal/health.js');
    const h = new Hono(); h.route('/', healthRoutes);
    const before = await h.request('/internal/health');
    const ok = await before.json() as { status: string; checks: Record<string, string>; loops: { stopped: string[] } };
    expect(ok.checks.loops).toBe('ok');
    expect(ok.loops.stopped).toEqual([]);

    await query(`UPDATE job_health SET last_success_at = ? WHERE job_name = 'business_outcome_tick'`, [hoursAgo(9)]);
    const r = await h.request('/internal/health');
    // Degraded in the word, not in the code: a stalled loop is not a reason to
    // restart the machine, so the HTTP status is whatever it was before the
    // loop stalled (in this harness the scheduler is not running, so that is
    // already 503; in production it is 200 either way).
    expect(r.status).toBe(before.status);
    const bad = await r.json() as { status: string; checks: Record<string, string>; loops: { stopped: string[] } };
    expect(bad.status).toBe('degraded');
    expect(bad.checks.loops).toBe('error');
    expect(bad.loops.stopped[0]).toContain('business_outcome_tick');
    await recordJobSuccess('business_outcome_tick');
  });
});

describe('when a routine stops, he is told once', () => {
  it('one notice per stoppage, through the account-notice door, and not again until it stops again', async () => {
    const { registerToolHandler } = await import('../../src/services/outbound/gateway.js');
    const { ACCOUNT_NOTICE_POLICY } = await import('../../src/services/billing/account-notice.js');
    const sent = vi.fn(async () => ({ message_id: 'em_pulse' }));
    registerToolHandler('send_account_notice', sent, ACCOUNT_NOTICE_POLICY);
    const tick = JOB_REGISTRY.institution_pulse_tick.fn;

    // Everything ran: nothing sent. (Stated here rather than inherited from the
    // previous test's cleanup, so a failure upstream cannot read as a stray
    // message downstream.)
    await allRanNow();
    await tick();
    expect(sent).not.toHaveBeenCalled();

    // The forge stops. One message, carrying the sentence and no error text.
    await query(`UPDATE job_health SET last_success_at = ? WHERE job_name = 'forge_tick'`, [hoursAgo(40)]);
    await tick();
    expect(sent).toHaveBeenCalledTimes(1);
    const req = sent.mock.calls[0]![0] as { params: { notice: { kind: string; detail: string } } };
    expect(req.params.notice.kind).toBe('institution_stopped');
    expect(req.params.notice.detail).toContain("Foundry hasn't completed its scheduled work.");

    // The next hour, still stopped: the same stoppage, so nothing more.
    await tick();
    await tick();
    expect(sent).toHaveBeenCalledTimes(1);

    // It recovers, and later stops again: a new stoppage, one new message.
    await recordJobSuccess('forge_tick');
    await tick();
    expect(sent).toHaveBeenCalledTimes(1);
    await query(`UPDATE job_health SET last_success_at = ? WHERE job_name = 'forge_tick'`, [hoursAgo(31)]);
    await tick();
    expect(sent).toHaveBeenCalledTimes(2);
    await recordJobSuccess('forge_tick');
  });
});
