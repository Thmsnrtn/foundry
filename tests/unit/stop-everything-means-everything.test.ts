process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { missionsOf } from '../../src/services/mission/read.js';
import { openMission } from '../../src/services/mission/write.js';

// =============================================================================
// STOP EVERYTHING MEANS EVERYTHING (Institution V6a, 30 September 2026;
// INSTITUTION_MODEL §11 V6, estate-wide Stop).
//
// The button said it "halts every routine, every permission and every
// outgoing action at once", and it stopped the routines of one company: an
// owner with three pressed it and two carried on. Now one press stops every
// company's routines, pauses anything new going out to people, and pauses
// every running Mission the owner stated — and touches nobody else's estate.
// It only ever lowers; starting again is one thing at a time.
// =============================================================================

const OWNER = 'f_stop';
const OTHER = 'f_stop_other';
let app: Hono;
let missionKey = '';

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'owner@example.com'], [OTHER, 'x@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clk_${id}`, email, 'X']);
  }
  for (const [id, owner] of [['p_s1', OWNER], ['p_s2', OWNER], ['p_s3', OWNER], ['p_x', OTHER]] as const) {
    await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES (?,?,?,'active','active','real')`, [id, `Co ${id}`, owner]);
    for (const cat of ['marketing', 'customer_success']) {
      await query(`INSERT INTO autopilot_policies (id, product_id, category, mode, set_by) VALUES (?,?,?,'act','founder')`, [`ap_${id}_${cat}`, id, cat]);
    }
  }
  await query(`INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,'p_s1','Apex Micro','Owner','https://apexmicro.example','apexmicro.example','hello@apexmicro.example','A small workshop.','')`, [OWNER]);
  missionKey = `mission:${await openMission({ founderId: OWNER, productId: null, asked: 'Build a landing page', goal: 'Build a landing page',
    mode: 'build', realm: 'real', terms: null })}`;
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const acting = async (productIds: string[]): Promise<number> => Number(((await query(
  `SELECT COUNT(*) AS n FROM autopilot_policies WHERE mode = 'act' AND product_id IN (${productIds.map(() => '?').join(',')})`, productIds)).rows[0] as Record<string, unknown>).n);

describe('one press', () => {
  it('stops every company of the owner, anything new going out, and their Missions; and nobody else', async () => {
    expect(await acting(['p_s1', 'p_s2', 'p_s3'])).toBe(6);
    const r = await app.request('/autopilot/panic', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'return_to=foundry' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/foundry/controls?done=stopped_all&companies=3&missions=1&outreach=1');
    expect(await acting(['p_s1', 'p_s2', 'p_s3'])).toBe(0);
    expect(await acting(['p_x'])).toBe(2);
    expect((await query(`SELECT economic_pause_at FROM public_workshop WHERE founder_id = ?`, [OWNER])).rows[0]).not.toMatchObject({ economic_pause_at: null });
    expect((await missionsOf(OWNER)).find((m) => m.key === missionKey)!.status).toBe('paused');
  });

  it('says what it stopped, and where to start each thing again', async () => {
    const html = await (await app.request('/foundry/controls?done=stopped_all&companies=3&missions=1&outreach=1')).text();
    expect(html).toContain('Everything is stopped:');
    expect(html).toContain('the routines of 3 companies, anything new going out to people, and 1 of your Missions');
    expect(html).toContain('Start things again one at a time');
  });

  it('only ever lowers: the stop grants, resumes and widens nothing', () => {
    const src = readFileSync('src/services/control/stop.ts', 'utf8');
    expect(src).not.toMatch(/resumeEconomicActivity|'resumed'|setPolicy\(|mode = 'act'/);
    expect(src).not.toMatch(/\bINSERT INTO|\bUPDATE\b/);
  });
});

describe('the record outlives the resume (F-PANIC-2)', () => {
  it('one Stop is one act on record across three companies, nobody else\'s estate is touched, and Resume adds to the record rather than erasing it', async () => {
    const { pauseHistory, resumeEconomicActivity, pauseNewEconomicActivity } = await import('../../src/services/public-workshop/settings.js');
    const stops = (await query(`SELECT product_id, input_context FROM audit_log WHERE action_type = 'estate_stopped' ORDER BY product_id`, [])).rows as unknown as Array<Record<string, unknown>>;
    expect(stops.map((r) => r.product_id)).toEqual(['p_s1', 'p_s2', 'p_s3']);
    expect(new Set(stops.map((r) => (JSON.parse(String(r.input_context)) as { stopId: string }).stopId)).size).toBe(1);
    expect(await pauseHistory(OTHER)).toEqual([]);

    await resumeEconomicActivity(OWNER);
    // A second resume with nothing paused writes nothing: the record says what happened, once.
    await resumeEconomicActivity(OWNER);
    const kinds = (await pauseHistory(OWNER)).map((h) => h.kind);
    expect(kinds.filter((k) => k === 'resumed')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'stopped')).toHaveLength(1);
    expect(kinds).toContain('paused');

    // A pause from the Workshop page alone is recorded too, with its reason.
    await pauseNewEconomicActivity({ founderId: OWNER, reason: 'away for the weekend' });
    const latest = (await pauseHistory(OWNER))[0]!;
    expect(latest).toMatchObject({ kind: 'paused', principal: `founder:${OWNER}`, reason: 'away for the weekend' });
    await resumeEconomicActivity(OWNER);
    const resumed = (await pauseHistory(OWNER))[0]!;
    expect(resumed).toMatchObject({ kind: 'resumed', principal: `founder:${OWNER}`, reason: 'away for the weekend', waitingRecipients: 0 });
  });
});
