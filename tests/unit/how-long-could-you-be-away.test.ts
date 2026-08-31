process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getStepAwayHorizon } from '../../src/services/institution/absence-summary.js';

// =============================================================================
// HOW LONG COULD YOU BE AWAY — AND EVERYTHING THAT QUESTION CANNOT ANSWER.
//
// `getSevenDayResponsibilitySummary` answers what happened in the last seven
// days, classified the way EXPERIENCE.md requires. It is backward looking. The
// founder's actual question before they go is the other one, and nothing
// answered it.
//
// THIS IS A FACT, NOT A PREDICTION. Foundry does not estimate how long it can
// cope. It reads the soonest date the COMPANY ITSELF stated on a still-active
// responsibility and reports the interval to it. A responsibility with no
// stated date contributes nothing in either direction.
//
// Which is why the caveats travel with the number. A horizon computed only from
// dated obligations is silent about undated ones, and reporting "eleven days"
// while four things wait with no clock would be a composite resting on what it
// did not measure. `loopsStopped` is the sharpest of the three: a quiet reading
// from a system that has stopped looking is not evidence of quiet.
// =============================================================================

const P = 'p_horizon';
const NOW = new Date('2026-08-20T12:00:00.000Z');

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('f_hz','c_hz','hz@example.com')");
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme','f_hz','active')", [P]);
});

beforeEach(async () => {
  // CHILDREN FIRST, NAMED. Eleven tables reference a responsibility, and
  // rendering The Letter can create rows in several of them — an evidence
  // request, a candidate decision, a transition. Deleting the parent while any
  // of those stand is exactly what the foreign key is for, so the teardown
  // states the order rather than switching the constraint off: a test that
  // disables the rule it is standing on proves less than one that obeys it.
  // `responsibility_transitions` carries no `product_id` — it belongs to the
  // responsibility, not to the company — so it is cleared through its parent.
  await query(
    `DELETE FROM responsibility_transitions WHERE responsibility_id IN
       (SELECT id FROM institutional_responsibilities WHERE product_id=?)`, [P]);
  for (const table of [
    'responsibility_dispositions', 'responsibility_candidate_decisions',
    'responsibility_shadow_expectations', 'founder_evidence_requests',
    'autonomy_consents', 'outbound_actions', 'inbound_customer_messages',
    'support_channels', 'development_change_plans', 'cost_events',
  ]) {
    await query(`DELETE FROM ${table} WHERE product_id=?`, [P]);
  }
  await query('DELETE FROM institutional_responsibilities WHERE product_id=?', [P]);
  await query('DELETE FROM signal_events WHERE product_id=?', [P]);
  await query('DELETE FROM job_health', []);
});

async function responsibility(
  id: string, title: string, dueAt: string | null, state = 'shadowing',
): Promise<void> {
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`,
    [`sig_${id}`, P]);
  await query(
    `INSERT INTO institutional_responsibilities
       (id,product_id,title,capability,state,discovery_evidence_ref,due_at,due_stated_by)
     VALUES (?,?,?,'operations',?,?,?,?)`,
    [id, P, title, state, `signal_event:sig_${id}`, dueAt, dueAt ? 'f_hz' : null]);
}

describe('the number is a date the company gave, not an estimate', () => {
  it('reports the interval to the soonest stated date, and whose it is', async () => {
    await responsibility('r1', 'Renew the yard insurance', '2026-08-31T09:00:00.000Z');
    await responsibility('r2', 'File the quarterly return', '2026-08-25T09:00:00.000Z');

    const horizon = await getStepAwayHorizon(P, NOW);
    expect(horizon.soonestDueTitle).toBe('File the quarterly return');
    expect(horizon.daysUntilSoonestDue).toBe(4);
  });

  it('rounds down, because rounding up hands the founder a day they do not have', async () => {
    // Thirty hours away is one day, not two.
    await responsibility('r1', 'Return the hire plant', '2026-08-21T18:00:00.000Z');
    expect((await getStepAwayHorizon(P, NOW)).daysUntilSoonestDue).toBe(1);
  });

  it('an overdue thing is not a horizon — it is a debt, counted separately', async () => {
    await responsibility('r1', 'Chase the Fenwick invoice', '2026-08-18T09:00:00.000Z');
    const horizon = await getStepAwayHorizon(P, NOW);
    expect(horizon.alreadyOverdue).toBe(1);
    expect(horizon.daysUntilSoonestDue).toBeNull();
    expect(horizon.soonestDueTitle).toBeNull();
  });

  it('a responsibility the owner set aside does not hold them to a date', async () => {
    // THROUGH THE LEDGER, because the database refuses anything else:
    // `responsibility_disposition:no_record` is migration 160 stopping a
    // governed column being written around its own record. Deciding not to do
    // something is a decision with an owner and a reason, and the test states
    // it the way the institution requires rather than reaching past the guard.
    const { setResponsibilityDisposition } = await import(
      '../../src/services/institution/responsibility.js');
    await responsibility('r1', 'Renew the yard insurance', '2026-08-25T09:00:00.000Z');
    await setResponsibilityDisposition({
      productId: P, responsibilityId: 'r1', ownerId: 'f_hz',
      disposition: 'deliberately_not_done',
      reason: 'The broker handles this and always has.',
      evidenceRef: 'signal_event:sig_r1',
    });
    expect((await getStepAwayHorizon(P, NOW)).daysUntilSoonestDue).toBeNull();
  });
});

describe('what the number is silent about travels with it', () => {
  it('null days is not "leave indefinitely" when things still need the founder', async () => {
    // The whole reason the caveats are returned beside the number.
    await responsibility('r1', 'Answer the Hartley enquiry', null);
    const horizon = await getStepAwayHorizon(P, NOW);
    expect(horizon.daysUntilSoonestDue).toBeNull();
    expect(horizon.needingYouWithoutDate).toBeGreaterThan(0);
  });

  it('counts the undated things that need them, beside a real horizon', async () => {
    await responsibility('r1', 'File the quarterly return', '2026-08-25T09:00:00.000Z');
    await responsibility('r2', 'Answer the Hartley enquiry', null);
    const horizon = await getStepAwayHorizon(P, NOW);
    expect(horizon.daysUntilSoonestDue).toBe(4);
    expect(horizon.needingYouWithoutDate).toBeGreaterThan(0);
  });

  it('a quiet reading from a system that stopped looking is reported as such', async () => {
    // Absence of a signal is not a signal.
    await query(
      `INSERT INTO job_health (job_name,last_failure_at,consecutive_failures,last_error_name,updated_at)
       VALUES ('institutional_effect_reconciliation',datetime('now'),9,'Error',datetime('now'))`);
    const horizon = await getStepAwayHorizon(P, NOW);
    expect(horizon.loopsStopped).toBeGreaterThan(0);
  });

  it('a healthy institution with nothing dated says so without inventing comfort', async () => {
    const horizon = await getStepAwayHorizon(P, NOW);
    expect(horizon).toMatchObject({
      daysUntilSoonestDue: null, soonestDueAt: null, soonestDueTitle: null,
      alreadyOverdue: 0, loopsStopped: 0,
    });
  });
});

describe('the founder reads it, with the caveats in the same breath', () => {
  async function letter(): Promise<string> {
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: 'f_hz', email: 'hz@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    return (await app.request('/letter')).text();
  }

  it('names the days and what is due, not a score', async () => {
    await responsibility('r1', 'File the quarterly return',
      new Date(Date.now() + 4 * 86_400_000).toISOString());
    const page = await letter();
    expect(page).toContain('If you went away');
    expect(page).toContain('File the quarterly return');
    expect(page).toMatch(/\d+ days until/);
  });

  it('a true number does not travel alone', async () => {
    // A founder who reads "4 days" and stops reading has been misled by a true
    // number. The undated things that need them are in the same sentence.
    await responsibility('r1', 'File the quarterly return',
      new Date(Date.now() + 4 * 86_400_000).toISOString());
    await responsibility('r2', 'Answer the Hartley enquiry', null);
    const page = await letter();
    expect(page).toMatch(/carry no date/);
    expect(page).toMatch(/does not speak for/);
  });

  it('says plainly that no date is not permission to go', async () => {
    await responsibility('r2', 'Answer the Hartley enquiry', null);
    const page = await letter();
    expect(page).toMatch(/No date is not the same as nothing to do/i);
  });

  it('is silent when there is genuinely nothing to say', async () => {
    // A quiet company produces a quiet Letter. The section does not render
    // itself to prove it ran.
    expect(await letter()).not.toContain('If you went away');
  });
});
