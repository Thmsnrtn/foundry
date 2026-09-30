process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { missionsOf } from '../../src/services/mission/read.js';
import { MissionRefused, actOnMission, openMission, readTerms, setTerms } from '../../src/services/mission/write.js';
import { openUndertaking } from '../../src/services/institution/undertaking.js';

// =============================================================================
// A MISSION GRANTS NOTHING (Mission Control, 30 September 2026).
//
// The owner can state a Mission no engine carries yet, and put limits on any
// Mission — a budget, an end date, what counts as success, what stops it,
// how loudly it may interrupt. Every one of those is kept, never edited. And
// none of it can let Foundry do more: no gate that decides whether Foundry may
// act reads a Mission's rows. A limit is a tripwire Foundry watches and brings
// to him — crossing it makes the Mission need him, and nothing else.
// =============================================================================

const OWNER = 'f_grants';
const STRANGER = 'f_other';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'owner@example.com'], [STRANGER, 'x@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clk_${id}`, email, 'X']);
  }
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_g','Lamplight',?,'active','active','real')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_x','Theirs',?,'active','active','real')`, [STRANGER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const post = (path: string, fields: Record<string, string>): Promise<Response> => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

describe('stating a Mission', () => {
  it('keeps his goal and his limits, and shows it with what Foundry will do next', async () => {
    const r = await post('/foundry/missions', { asked: 'Build a landing page for the workbook', goal: 'Build a landing page for the workbook',
      mode: 'build', realm: 'real', productId: 'p_g', budget: '40', until: '2099-12-31', success: 'it is live', stopWhen: 'it costs more than $40', interruptAt: 'today' });
    expect(r.status).toBe(302);
    const key = decodeURIComponent(r.headers.get('location')!.split('/').pop()!);
    const m = (await missionsOf(OWNER)).find((x) => x.key === key)!;
    expect(m).toMatchObject({ source: 'mission', mode: 'build', status: 'waiting', company: { id: 'p_g' } });
    expect(m.statusDetail).toContain('Foundry can propose, not build, yet');
    expect(m.terms).toMatchObject({ budgetCents: 4000, until: '2099-12-31', interruptAt: 'today' });
    const html = await (await app.request(`/foundry/missions/${encodeURIComponent(key)}`)).text();
    expect(html).toContain('Build a landing page for the workbook');
    expect(html).toContain('Next, Foundry will');
    expect(html).toContain('value="40.00"');
  });

  it('refuses a bad limit without losing what he typed, and says why', async () => {
    const r = await post('/foundry/missions', { goal: 'Grow the newsletter', mode: 'optimize', realm: 'real', budget: 'lots', until: 'someday' });
    expect(r.status).toBe(422);
    const html = await r.text();
    expect(html).toContain('That was not started.');
    expect(html).toContain('value="Grow the newsletter"');
    expect(html).toContain('value="lots"');
  });

  it('will not state a trading Mission as anything but a simulation', async () => {
    const real = await post('/foundry/missions', { goal: 'Trade the Fed decision with $100', mode: 'monitor', realm: 'real' });
    expect(real.status).toBe(422);
    expect(await real.text()).toContain('Trading can only be a simulation here');
    const sim = await post('/foundry/missions', { goal: 'Trade the Fed decision with $100', mode: 'monitor', realm: 'simulation' });
    expect(sim.status).toBe(302);
    expect((await query(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%order%' AND name NOT LIKE 'venue_orders%'`)).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('will not name someone else\'s company as its subject', async () => {
    await expect(openMission({ founderId: OWNER, productId: 'p_x', asked: 'x', goal: 'x', mode: 'build', realm: 'real', terms: null }))
      .rejects.toBeInstanceOf(MissionRefused);
  });
});

describe('limits on any Mission', () => {
  it('can be put on work read from an engine, are superseded rather than edited, and a crossed end date needs him', async () => {
    const u = await openUndertaking({ founderId: OWNER, productId: 'p_g', kind: 'grow', asked: 'Grow Lamplight', understoodAs: 'Grow Lamplight',
      openedBy: `founder:${OWNER}`, from: { kind: 'owner', id: null } });
    const key = `undertaking:${u!.id}`;
    await setTerms(OWNER, key, readTerms({ until: '2099-01-01' }));
    await setTerms(OWNER, key, readTerms({ until: '2000-01-01' }));
    const live = await query(`SELECT until FROM mission_terms WHERE founder_id = ? AND mission_key = ? AND superseded_by IS NULL`, [OWNER, key]);
    expect(live.rows).toHaveLength(1);
    expect((await query(`SELECT COUNT(*) AS n FROM mission_terms WHERE mission_key = ?`, [key])).rows[0]).toMatchObject({ n: 2 });
    const m = (await missionsOf(OWNER)).find((x) => x.key === key)!;
    expect(m.status).toBe('needs_you');
    expect(m.statusDetail).toContain('past the end date you set');
    await expect(query(`UPDATE mission_terms SET until = '2100-01-01' WHERE mission_key = ?`, [key])).rejects.toThrow(/never edited/);
  });

  it('refuses limits on work that is not his, as if it did not exist', async () => {
    const theirs = await openUndertaking({ founderId: STRANGER, productId: 'p_x', kind: 'fix', asked: 'Fix it', understoodAs: 'Fix it',
      openedBy: `founder:${STRANGER}`, from: { kind: 'owner', id: null } });
    const r = await post(`/foundry/missions/${encodeURIComponent(`undertaking:${theirs!.id}`)}/terms`, { budget: '10' });
    expect(r.status).toBe(404);
    expect((await query(`SELECT COUNT(*) AS n FROM mission_terms WHERE founder_id = ?`, [STRANGER])).rows[0]).toMatchObject({ n: 0 });
    await expect(setTerms(OWNER, 'mandate:does-not-exist', readTerms({}))).rejects.toBeInstanceOf(MissionRefused);
    await expect(setTerms(OWNER, 'made_up:1', readTerms({}))).rejects.toBeInstanceOf(MissionRefused);
  });

  it('keeps a bad limit on the page with his values, answered 422', async () => {
    const [m] = (await missionsOf(OWNER)).filter((x) => x.source === 'mission');
    const r = await post(`/foundry/missions/${encodeURIComponent(m!.key)}/terms`, { budget: '-5', success: 'keep this' });
    expect(r.status).toBe(422);
    const html = await r.text();
    expect(html).toContain('That was not saved.');
    expect(html).toContain('value="keep this"');
  });
});

describe('what he does to one', () => {
  it('pauses, resumes and stops a Mission he stated, and the record keeps each act', async () => {
    const [m] = (await missionsOf(OWNER)).filter((x) => x.source === 'mission' && x.mode === 'build');
    await actOnMission(OWNER, m!.key, 'paused');
    expect((await missionsOf(OWNER)).find((x) => x.key === m!.key)!.status).toBe('paused');
    await actOnMission(OWNER, m!.key, 'resumed');
    expect((await missionsOf(OWNER)).find((x) => x.key === m!.key)!.status).toBe('waiting');
    await actOnMission(OWNER, m!.key, 'stopped');
    expect((await missionsOf(OWNER)).find((x) => x.key === m!.key)!.status).toBe('stopped');
    await expect(query(`UPDATE mission_events SET said = 'x' WHERE mission_key = ?`, [m!.key])).rejects.toThrow(/kept as it was/);
  });

  it('sends a stop for work read from an engine to that work\'s own Stop, so there is one way to do it', async () => {
    const [u] = (await missionsOf(OWNER)).filter((x) => x.source === 'undertaking');
    await expect(actOnMission(OWNER, u!.key, 'stopped')).rejects.toThrow(/its own page/);
  });
});

describe('what a Mission cannot do', () => {
  it('is read by no gate that decides whether Foundry may act', () => {
    const gates = ['src/services/outbound', 'src/services/ai/client.ts', 'src/services/institution/charter.ts',
      'src/services/institution/standing-intent.ts', 'src/services/institution/spending.ts', 'src/services/autopilot',
      'src/services/founder/authority.ts', 'src/services/venture/hand.ts'];
    const files = (p: string): string[] => statSync(p).isDirectory()
      ? readdirSync(p).flatMap((f) => files(join(p, f))) : p.endsWith('.ts') ? [p] : [];
    for (const f of gates.flatMap(files)) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bmission(s|_terms|_events)\b|services\/mission\//);
    }
  });

  it('writes nothing but its own three tables', () => {
    const src = readFileSync('src/services/mission/write.ts', 'utf8');
    const written = [...src.matchAll(/\b(?:INSERT INTO|UPDATE)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(written)).toEqual(new Set(['missions', 'mission_terms', 'mission_events']));
  });
});

describe('from the composer', () => {
  it('offers to make a goal it could not place into a Mission, carrying his words', async () => {
    const r = await post('/foundry/ask', { said: 'Build a landing page for the workbook' });
    const html = await r.text();
    expect(html).toContain('I did not follow that');
    expect(html).toContain('/foundry/missions/new?said=Build%20a%20landing%20page%20for%20the%20workbook');
    const form = await (await app.request('/foundry/missions/new?said=Get%20to%20%24500%20a%20month')).text();
    expect(form).toContain('value="Get to $500 a month"');
  });
});
