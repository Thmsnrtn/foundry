process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { budgetInside, currentMandate, horizonOf, readVentureParagraph } from '../../src/services/venture/mandate.js';
import { missionsOf } from '../../src/services/mission/read.js';

// =============================================================================
// A DIGITAL PRODUCT UNDER A HUNDRED DOLLARS (Institution V3a, 30 September
// 2026; the long-horizon directive's first vertical slice, 607: "Find a
// low-maintenance digital product to test this month, ≤$100").
//
// The sentence opened a search and dropped everything the owner put inside
// it: the form, "low-maintenance", the $100, "this month". Now each is read,
// listed on the confirmation before the owner says yes, and kept where it
// governs — the form on the search, the preference and the budget as the
// search's own steering, the date and the amount as the search Mission's
// terms (a tripwire brought back to the owner, never a permission). Saying yes
// spends nothing, sends nothing and approves no test.
// =============================================================================

const OWNER = 'f_607';
const SAID = 'Find a low-maintenance digital product to test this month, ≤$100';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_607', 'owner@example.com', 'Owner']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const post = (path: string, fields: Record<string, string>): Promise<Response> => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

describe('the reading', () => {
  it('hears the search, its form, the preference and the budget in one clause', () => {
    const r = readVentureParagraph(SAID);
    expect(r[0]).toMatchObject({ kind: 'mandate', shape: 'digital_product' });
    expect(r.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'guidance', guidance: 'prefer', dimension: 'support_burden' }),
      expect.objectContaining({ kind: 'guidance', guidance: 'budget', subject: '100' }),
    ]));
    for (const [s, n] of [['for under $100', '100'], ['$49.50 or less', '49.50'], ['at most $20', '20'], ['with a $100 budget', '100'], ['a $100 product', null]] as const) {
      expect(budgetInside(s), s).toBe(n);
    }
  });
});

describe('from the composer to a search held to it', () => {
  it('lists every limit before the owner says yes', async () => {
    const html = await (await post('/foundry/ask', { said: SAID })).text();
    expect(html).toContain('Go and look?');
    expect(html).toContain('a digital-product business');
    expect(html).toContain('I will spend at most $100');
    expect(html).toContain('I will weight the search toward almost no support burden');
    const due = (await horizonOf('this month'))!;
    expect(due).toMatch(/^\d{4}-\d{2}-(28|29|30|31)$/);
    expect(html).toContain(`I will bring it back to you by ${due}, found or not.`);
    expect(await currentMandate(OWNER)).toBeNull();
  });

  it('keeps each limit where it governs, and spends, sends and approves nothing', async () => {
    const r = await post('/foundry/venture/confirm', { said: SAID });
    expect(r.status).toBe(302);
    const m = (await currentMandate(OWNER))!;
    expect(m).toMatchObject({ statement: SAID, shape: 'digital_product' });
    expect(m.guidance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'budget', subject: '100' }),
      expect.objectContaining({ kind: 'prefer', dimension: 'support_burden' }),
    ]));
    const search = (await missionsOf(OWNER)).find((x) => x.key === `mandate:${m.id}`)!;
    expect(search.terms).toMatchObject({ budgetCents: 10000, until: await horizonOf('this month') });
    expect(search.tripped).toBeNull();
    for (const t of ['outbound_actions', 'venture_experiments']) {
      expect((await query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0], t).toMatchObject({ n: 0 });
    }
    // Explore says what is being looked for.
    expect(await (await app.request('/foundry/explore')).text()).toContain(SAID.replace('≤', '≤'));
  });

  it('brings the search back to the owner once the month is over, and acts on nothing', async () => {
    const m = (await currentMandate(OWNER))!;
    const last = (await horizonOf('this month'))!;
    // Still in time on the last day; brought back the day after.
    expect((await missionsOf(OWNER, new Date(`${last}T12:00:00Z`))).find((x) => x.key === `mandate:${m.id}`)!.tripped).toBeNull();
    const after = new Date(Date.parse(`${last}T12:00:00Z`) + 86_400_000);
    const search = (await missionsOf(OWNER, after)).find((x) => x.key === `mandate:${m.id}`)!;
    expect(search.tripped).toBe('until');
    expect(search.status).toBe('needs_you');
    expect((await currentMandate(OWNER))).not.toBeNull();
  });
});
