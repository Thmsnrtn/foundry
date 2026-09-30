process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { missionOfUndertaking, missionsOf } from '../../src/services/mission/read.js';
import { openUndertaking } from '../../src/services/institution/undertaking.js';
import { beginObserving } from '../../src/services/capital/research.js';

// =============================================================================
// MISSIONS ARE READ FROM THE WORK (Mission Control, 30 September 2026).
//
// The Missions door shows the work Foundry carries — the search, each test,
// work taken on for a company, the trading research — as one kind of object.
// None of it is stored twice: every Mission is derived from the row it is, so
// it can never disagree with that row's own page. And a Mission can do
// nothing: the reader writes no row and reaches no door that acts.
// =============================================================================

const OWNER = 'f_missions';
const STRANGER = 'f_stranger';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'owner@example.com'], [STRANGER, 'someone@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clk_${id}`, email, 'X']);
  }
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_m','Lamplight',?,'active','active','real')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_s','Theirs',?,'active','active','real')`, [STRANGER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('with nothing under way', () => {
  it('shows an empty state that teaches, rather than an empty list', async () => {
    const html = await (await app.request('/foundry/missions')).text();
    expect(html).toContain('Foundry is carrying nothing for you right now.');
    expect(html).toContain('class="empty-teach"');
    expect(html).toMatch(/For example: <q>/);
  });
});

describe('work taken on for a company', () => {
  it('is a Mission, scoped to that company, running, with what Foundry does next', async () => {
    const u = await openUndertaking({ founderId: OWNER, productId: 'p_m', kind: 'grow', asked: 'Grow Lamplight',
      understoodAs: 'Grow Lamplight', openedBy: `founder:${OWNER}`, from: { kind: 'owner', id: null } });
    expect(u).not.toBeNull();
    const all = await missionsOf(OWNER);
    const m = all.find((x) => x.key === `undertaking:${u!.id}`);
    expect(m).toMatchObject({ mode: 'optimize', status: 'running', company: { id: 'p_m', name: 'Lamplight' }, concluded: false });
    expect(m!.next).toBeTruthy();
    const card = await (await app.request('/foundry/missions')).text();
    expect(card).toContain('Grow Lamplight');
    const detail = await app.request(`/foundry/missions/${encodeURIComponent(m!.key)}`);
    expect(detail.status).toBe(200);
    const body = await detail.text();
    expect(body).toContain('Next, Foundry will');
    expect(body).toContain('None set here; the charter and allowances still bind');
  });

  it('reads a closed piece of work as concluded, in the one status vocabulary', () => {
    const base = { id: 'u1', productId: 'p', companyName: 'C', kind: 'fix', kindInWords: 'Fix', asked: null, understoodAs: 'Fix it',
      openedBy: 'x', openedFrom: { kind: 'owner', id: null }, openedAt: '2026-09-01', closedBy: null, supersededBy: null, evidenceMode: 'real' as const };
    expect(missionOfUndertaking({ ...base, closedAt: '2026-09-02', closedAs: 'done', closedBecause: 'Fixed.' }, null).status).toBe('succeeded');
    expect(missionOfUndertaking({ ...base, closedAt: '2026-09-02', closedAs: 'dropped', closedBecause: 'You stopped it.' }, null).status).toBe('stopped');
    expect(missionOfUndertaking({ ...base, closedAt: '2026-09-02', closedAs: 'superseded', closedBecause: null }, null).status).toBe('archived');
    expect(missionOfUndertaking({ ...base, closedAt: null, closedAs: null, closedBecause: null }, null).status).toBe('running');
  });
});

describe('the trading research', () => {
  it('is a Monitor Mission in simulation, and says no order is possible', async () => {
    await beginObserving(OWNER, 'kalshi');
    const m = (await missionsOf(OWNER)).find((x) => x.source === 'thesis');
    expect(m).toMatchObject({ mode: 'monitor', realm: 'simulation', status: 'running' });
    expect(m!.statusDetail).toContain('No order is possible');
    expect(m!.limits.budget).toMatch(/nothing here spends or trades/);
  });
});

describe('what a Mission cannot do', () => {
  it('reads only: the reader writes no row, and every write on the page is the owner\'s own act', () => {
    const src = readFileSync('src/services/mission/read.ts', 'utf8');
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/);
    const route = readFileSync('src/routes/dashboard/missions-place.ts', 'utf8');
    for (const m of route.matchAll(/missionRoutes\.post\('([^']+)', ([a-zA-Z]+)\(/g)) expect(m[2], m[1]).toBe('requireInstitutionOwner');
  });

  it('never shows another owner\'s work, even by its key', async () => {
    const theirs = await openUndertaking({ founderId: STRANGER, productId: 'p_s', kind: 'fix', asked: 'Fix Theirs',
      understoodAs: 'Fix Theirs', openedBy: `founder:${STRANGER}`, from: { kind: 'owner', id: null } });
    expect((await missionsOf(OWNER)).some((m) => m.key === `undertaking:${theirs!.id}`)).toBe(false);
    const r = await app.request(`/foundry/missions/${encodeURIComponent(`undertaking:${theirs!.id}`)}`);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('Fix Theirs');
  });

  it('escapes the owner\'s own words when it shows them back', async () => {
    await openUndertaking({ founderId: OWNER, productId: 'p_m', kind: 'fix', asked: '<script>alert(1)</script>',
      understoodAs: '<script>alert(1)</script>', openedBy: `founder:${OWNER}`, from: { kind: 'owner', id: null } });
    const html = await (await app.request('/foundry/missions')).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
