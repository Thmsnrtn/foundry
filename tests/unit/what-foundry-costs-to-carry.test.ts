// =============================================================================
// WHAT FOUNDRY COSTS TO CARRY — MEASURED WHERE IT CAN BE, STATED WHERE IT
// CANNOT, AND NEVER FREE BECAUSE NOBODY SAID.
//
// The executive review of 29 September 2026 found no figure for what running
// Foundry costs (F-1): the hold rule compares what an asset earns with what it
// costs to keep, and one side of that had no number at all. Model and tool
// spend are read from Foundry's own records; the bills it cannot read — the
// machine, Cloudflare, domains, Clerk, the shop — are the owner's word, each
// with its source. A bill nobody stated is shown as not known, and the total
// says "at least".
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'cc_owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { carryingCost, stateCostLine } from '../../src/services/economy/projection.js';

const OWNER = 'cc_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_cc', 'cc_owner@example.com', 'Owner']);
  const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'cc_owner@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', moneyRoutes);
});

const text = async (path: string): Promise<string> => (await (await app.request(path)).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const post = (body: Record<string, string>) => app.request('/foundry/money/costs', {
  method: 'POST', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

describe('before anything is stated', () => {
  it('measures what it can and calls every unread bill not known, never zero', async () => {
    const c = await carryingCost(OWNER);
    expect(c.lines.find((l) => l.kind === 'measured' && /models/.test(l.what))?.cents).toBe(0);
    const fly = c.lines.find((l) => /^Fly/.test(l.what));
    expect(fly).toMatchObject({ cents: null, kind: 'not_stated' });
    expect(c.notKnown.length).toBe(5);
    expect(c.total.because).toMatch(/^at least this: 5 bills are not known/);
  });
});

describe('the owner states a bill', () => {
  it('with its source, and the newest statement is the one read; the old one is kept', async () => {
    await stateCostLine(OWNER, 'fly', 570, 'the September Fly invoice');
    await stateCostLine(OWNER, 'fly', 620, 'the October Fly invoice');
    const c = await carryingCost(OWNER);
    const fly = c.lines.find((l) => /^Fly/.test(l.what))!;
    expect(fly).toMatchObject({ cents: 620, kind: 'stated' });
    expect(fly.because).toMatch(/October Fly invoice/);
    expect(Number(((await query(`SELECT COUNT(*) AS n FROM foundry_cost_lines WHERE provider = 'fly'`)).rows[0] as Record<string, unknown>).n)).toBe(2);
    await expect(query(`UPDATE foundry_cost_lines SET monthly_cents = 0`)).rejects.toThrow(/said_is_said/);
  });

  it('"I do not know yet" is kept as not known, not as zero', async () => {
    await stateCostLine(OWNER, 'clerk', null, 'not sure which plan the production instance will need');
    const c = await carryingCost(OWNER);
    expect(c.lines.find((l) => /^Clerk/.test(l.what))).toMatchObject({ cents: null, kind: 'stated' });
    expect(c.notKnown).toContain('Clerk (signing in)');
  });

  it('refuses a bill with no source, a negative amount, or a provider it does not know', async () => {
    await expect(stateCostLine(OWNER, 'fly', 100, '  ')).rejects.toThrow(/where the number came from/);
    await expect(stateCostLine(OWNER, 'fly', -5, 'x')).rejects.toThrow(/not a monthly amount/);
    await expect(stateCostLine(OWNER, 'aws' as never, 5, 'x')).rejects.toThrow(/not a provider/);
    await expect(query(`INSERT INTO foundry_cost_lines (id, founder_id, provider, monthly_cents, source, said_by)
      VALUES ('x', ?, 'fly', 1, 's', 'institution:auto')`, [OWNER])).rejects.toThrow();
  });

  it('once every bill is stated, the total stops saying "at least"', async () => {
    for (const p of ['cloudflare', 'domains', 'clerk', 'etsy'] as const) await stateCostLine(OWNER, p, 100, `the ${p} bill`);
    const c = await carryingCost(OWNER);
    expect(c.notKnown).toEqual([]);
    expect(c.total).toMatchObject({ cents: 1020, quality: 'estimated' });
  });
});

describe('on the Economics page', () => {
  it('shows the lines, which are measured and which are his, and takes a new one through the form', async () => {
    const r = await post({ provider: 'domains', amount: '1.50', source: 'the registrar renewal, a year divided by twelve' });
    expect(r.headers.get('location')).toMatch(/done=carry/);
    const t = await text('/foundry/money');
    expect(t).toMatch(/What Foundry costs to carry each month/);
    expect(t).toMatch(/\$1\.50 Domains · yours · your figure: the registrar renewal/);
    expect(t).toMatch(/Thinking \(models\), last 30 days · measured/);
    expect((await post({ provider: 'fly', amount: 'lots', source: 'x' })).headers.get('location')).toMatch(/error=/);
    expect((await post({ provider: 'fly', amount: '5', source: '' })).headers.get('location')).toMatch(/error=/);
  });
});
