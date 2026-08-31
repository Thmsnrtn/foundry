process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getShadowableResponsibilities, getUnwatchableResponsibilities,
} from '../../src/services/institution/external-shadowing.js';

// =============================================================================
// I UNDERSTAND THIS AND I CANNOT SEE IT.
//
// `getShadowableResponsibilities` returns an empty list when the company has no
// observation channel — `if (!channels.length) return []` — so the "What would
// you expect to see?" offer does not render. Correct, and a silent dead end.
// The founder reported an obligation, answered Foundry's questions about it,
// watched it reach Understood, and then nothing: no offer, and no reason for
// its absence.
//
// A channel exists only once an `external_metric_ingest` reading has actually
// arrived, so a company that has connected nothing and posted nothing has none
// by construction. THIS IS THE FIRST RUNG OF THE LADDER AND EVERY NEW COMPANY
// STARTS BELOW IT — Understood → Shadowing is what turns a described obligation
// into something Foundry watches, and it cannot be crossed until a number
// arrives from outside.
//
// "Nothing is happening" and "I cannot see" are different facts. The founder
// can act on the second and can do nothing at all with the first.
// =============================================================================

const P = 'p_unwatch';
const OWNER = 'f_uw';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_uw', 'uw@example.com']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme',?,'active')",
    [P, OWNER]);
});

beforeEach(async () => {
  await query(
    `DELETE FROM responsibility_transitions WHERE responsibility_id IN
       (SELECT id FROM institutional_responsibilities WHERE product_id=?)`, [P]);
  await query('DELETE FROM institutional_responsibilities WHERE product_id=?', [P]);
  await query('DELETE FROM signal_events WHERE product_id=?', [P]);
  await query('DELETE FROM metric_snapshots WHERE product_id=?', [P]);
});

async function understood(id: string, title: string): Promise<void> {
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`,
    [`sig_${id}`, P]);
  await query(
    `INSERT INTO institutional_responsibilities
       (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,?,'operations','understood',?)`,
    [id, P, title, `signal_event:sig_${id}`]);
}

/**
 * AN OBSERVATION IS A MOVEMENT, NOT A READING, and the database says so:
 * `external_observation:payload_invalid` refuses a payload without an origin, a
 * previous value and an observed value. So the fixture reports two days of
 * numbers through the production writer and lets it derive the movement, rather
 * than hand-writing a signal event that could not exist.
 */
async function aReadingArrives(field = 'active_users'): Promise<void> {
  const { recordExternalMetricObservations } = await import(
    '../../src/services/institution/external-observation.js');
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${field})
     VALUES ('snap_prior', ?, date('now','-2 days'), 8)`, [P]);
  await recordExternalMetricObservations({
    productId: P, origin: 'ingest_token',
    readings: [{ field, observedValue: 12 }],
  });
}

describe('the dead end at the first rung', () => {
  it('names what it understands and cannot watch', async () => {
    await understood('r1', 'Keep the plant inspections current');
    expect(await getShadowableResponsibilities(P)).toEqual([]);
    expect(await getUnwatchableResponsibilities(P)).toEqual([
      { responsibilityId: 'r1', title: 'Keep the plant inspections current' },
    ]);
  });

  it('goes quiet the moment a number arrives, because the offer takes over', async () => {
    // The two are complements: exactly one of them speaks. Saying both would be
    // telling the founder they cannot see something they are being offered.
    await understood('r1', 'Keep the plant inspections current');
    await aReadingArrives();
    expect(await getUnwatchableResponsibilities(P)).toEqual([]);
    expect(await getShadowableResponsibilities(P)).toHaveLength(1);
  });

  it('says nothing about responsibilities that have not reached Understood', async () => {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('sig_r2',?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`,
      [P]);
    await query(
      `INSERT INTO institutional_responsibilities
         (id,product_id,title,capability,state,discovery_evidence_ref)
       VALUES ('r2',?,'Something only just noticed','operations','visible','signal_event:sig_r2')`,
      [P]);
    expect(await getUnwatchableResponsibilities(P)).toEqual([]);
  });

  it('a declared channel that has never reported does not count as sight', async () => {
    // Declaring a quantity is saying what you intend to report. It is not a
    // reading, and treating it as one would be the sensor-absence-as-zero
    // defect wearing a different hat.
    const { registerObservationChannel } = await import(
      '../../src/services/institution/company-observation.js');
    await understood('r1', 'Keep the plant inspections current');
    await registerObservationChannel({
      productId: P, founderId: OWNER, channelKey: 'inspections_current',
      label: 'Inspections in date', unit: 'count',
    });
    expect(await getUnwatchableResponsibilities(P)).toHaveLength(1);
  });
});

describe('the founder is told, and told what would change it', () => {
  async function letter(): Promise<string> {
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'uw@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    return (await app.request('/letter')).text();
  }

  it('names the responsibility and the remedy, which is theirs to take', async () => {
    await understood('r1', 'Keep the plant inspections current');
    const page = await letter();
    expect(page).toContain('What I cannot see yet');
    expect(page).toContain('Keep the plant inspections current');
    expect(page).toMatch(/ingest URL/i);
    expect(page).toContain('/settings');
  });

  it('promises no guess in the meantime', async () => {
    await understood('r1', 'Keep the plant inspections current');
    const page = await letter();
    expect(page).toMatch(/not going to guess a number/i);
  });

  it('disappears once the company can be seen', async () => {
    await understood('r1', 'Keep the plant inspections current');
    await aReadingArrives();
    expect(await letter()).not.toContain('What I cannot see yet');
  });
});
