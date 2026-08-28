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
  // Dispositions first: they reference the responsibility, and deleting the
  // parent while the record stands is exactly what the foreign key is for.
  await query('DELETE FROM responsibility_dispositions WHERE product_id=?', [P]);
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
