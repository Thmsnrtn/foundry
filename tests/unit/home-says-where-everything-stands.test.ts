process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { openMandate } from '../../src/services/venture/mandate.js';
import { readMandate, stateMandate } from '../../src/services/mandate/statements.js';
import { homeSummary } from '../../src/services/home/summary.js';
import { stagesOf } from '../../src/services/portfolio/stage.js';
import { exploreSummary } from '../../src/services/explore/summary.js';
import { needsYouCount } from '../../src/services/needs-you/queue.js';
import { proposeAct, setBoundary } from '../../src/services/institution/standing-intent.js';

// =============================================================================
// HOME SAYS WHERE EVERYTHING STANDS (Institution V5, 30 September 2026;
// INSTITUTION_MODEL §6 HomeSummary, §9 Home — the thirty-second test).
//
// One row per door: what is owned and at what stage, what Foundry is looking
// for, what the owner said they want, what needs them. Read from the same
// readers the doors bind to, so Home can never say something the page one
// tap away contradicts.
// =============================================================================

const OWNER = 'f_home';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_home', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_home','Lamplight',?,'active','active','real')`, [OWNER]);
  const m = await openMandate({ founderId: OWNER, statement: 'Find a low-maintenance digital product', shape: 'digital_product' });
  if ('refused' in m) throw new Error(m.refused);
  await stateMandate(OWNER, readMandate('No SaaS for now')!, 'direct');
  await stateMandate(OWNER, readMandate('Spend less this month')!, 'direct');
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the reading', () => {
  it('agrees with every door it summarises', async () => {
    const h = await homeSummary(OWNER);
    const stages = await stagesOf(OWNER);
    const explore = await exploreSummary(OWNER);
    expect(h.portfolio.operating).toBe(stages.filter((s) => s.group === 'Operating').length);
    expect(h.explore.inFlight).toBe(explore.work.length);
    expect(h.explore.lookingFor).toBe('Find a low-maintenance digital product');
    expect(h.needsYou).toBe(await needsYouCount(OWNER));
    expect(h.mandate).toMatchObject({ statements: 2, paused: ['SaaS'] });
    expect(h.mandate.spendingLessUntil).toMatch(/^\d{4}-\d{2}-01$/);
    expect(h.sentence).toBe('Nothing needs you. Foundry is working.');
  });

  it('says how many things need the owner once something does', async () => {
    await setBoundary({ productId: 'p_home', subject: 'set_prices', mode: 'ask_first', statement: 'Ask me before changing prices' });
    await proposeAct({ productId: 'p_home', subject: 'set_prices', actionType: null, params: { price: 49 },
      summary: 'Raise the price to $49', why: 'Buyers asked', expectedEffect: 'More per sale', risk: 'Fewer sales',
      consequence: 'low', proposedBy: 'institution:test' });
    const h = await homeSummary(OWNER);
    expect(h.needsYou).toBe(1);
    expect(h.sentence).toBe('1 thing needs you. Everything else is carrying on.');
  });
});

describe('Home', () => {
  it('shows one row per door, each a link to that door, and does not repeat the Needs-you count', async () => {
    const html = await (await app.request('/foundry')).text();
    const row = /<section class="panel stands-panel" aria-label="Where everything stands">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    // A row per door, and then the record (Roadmap 2027 R7, STRATEGY S24): how
    // often Foundry's sealed predictions came true, from the first grade.
    expect([...row.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual(
      ['/foundry/companies', '/foundry/explore', '/foundry/controls#mandate', '/foundry/experiments/history']);
    expect(row).toContain('1 in operation · 0 being tested');
    expect(row).toContain('Looking for: Find a low-maintenance digital product');
    expect(row).toContain('paused: SaaS');
    expect(row).toMatch(/spending less until \d{4}-\d{2}-01/);
    // The quick way into Explore is the Explore door, not the old Searching place.
    expect(html).toMatch(/<a class="qt" href="\/foundry\/explore">/);
  });
});
