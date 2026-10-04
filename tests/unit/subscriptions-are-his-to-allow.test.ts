// =============================================================================
// SUBSCRIPTIONS ARE HIS TO ALLOW.
//
//   the owner said "subscriptions" (PENDING 31) → the first-proof policy still
//   refuses recurring billing until HE supersedes it, from his own session →
//   "Allow" makes it a weight against a design, not a refusal → "Refuse again"
//   restores the refusal → every earlier row stays on record → nobody but a
//   founder principal can supersede his row → Control reads the state from the
//   row, not from a tick.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 's'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'subs@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { originationPolicyFor, supersedeOriginationPolicy } from '../../src/services/venture/legal-surface.js';
import { subscriptionsAllowed, yourDecisions } from '../../src/services/control/decisions.js';

const OWNER = 'subs_owner';
let app: Hono;
const tap = (allow: 'yes' | 'no') => app.request('https://f.test/foundry/controls/subscriptions', {
  method: 'POST', body: new URLSearchParams({ allow }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const recurringRow = async () => (await originationPolicyFor(OWNER)).find((p) => p.requirement === 'no_recurring_billing')!;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'subs_clk', 'subs@example.com', 'Owner']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'subs@example.com' } as never); await next(); });
  app.route('/', foundryShellRoutes);
});

describe('until he says so, the first-proof rule refuses', () => {
  it('starts refusing, and Control says it is his to open', async () => {
    const row = await recurringRow();
    expect(row.treatment).toBe('refuse');
    expect(row.ownersOwn).toBe(false);
    expect(await subscriptionsAllowed(OWNER)).toEqual({ allowed: false, on: null });
    const d = (await yourDecisions(OWNER, {})).find((x) => x.key === 'subscriptions')!;
    expect(d.state).toBe('open');
  });
});

describe('his tap, from his session', () => {
  it('allows them as a weight against a design, written as his act', async () => {
    const r = await tap('yes');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/subscriptions=allowed/);
    const row = await recurringRow();
    expect(row.ownersOwn).toBe(true);
    expect(row.treatment).toBe('penalise');
    expect(row.setBy).toBe(`founder:${OWNER}`);
    expect((await subscriptionsAllowed(OWNER)).allowed).toBe(true);
    expect((await yourDecisions(OWNER, {})).find((x) => x.key === 'subscriptions')!.state).toBe('done');
  });

  it('can be refused again, and every earlier row stays on record', async () => {
    const r = await tap('no');
    expect(r.headers.get('location')).toMatch(/subscriptions=refused_again/);
    expect((await recurringRow()).treatment).toBe('refuse');
    expect((await subscriptionsAllowed(OWNER)).allowed).toBe(false);
    const all = (await query(`SELECT treatment, superseded_at, superseded_by FROM origination_policy
      WHERE requirement = 'no_recurring_billing' ORDER BY set_at, rowid`, [])).rows as unknown as Array<Record<string, unknown>>;
    // The institution's default, his allowance, his refusal: three rows, none rewritten.
    expect(all.map((x) => x.treatment)).toEqual(['refuse', 'penalise', 'refuse']);
    expect(all[0]!.superseded_at).toBeNull();
    expect(all[1]!.superseded_by).toBe(`founder:${OWNER}`);
  });

  it('cannot be superseded by anything that is not a person', async () => {
    await tap('yes');
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'no_recurring_billing', treatment: 'refuse', why: 'a charter said so', by: 'charter:x' });
    expect('refused' in r && r.refused).toMatch(/supersession_needs_a_person/);
    expect((await subscriptionsAllowed(OWNER)).allowed).toBe(true);
  });
});
