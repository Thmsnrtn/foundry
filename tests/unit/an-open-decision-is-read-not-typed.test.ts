process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { yourDecisions } from '../../src/services/control/decisions.js';

// =============================================================================
// AN OPEN DECISION IS READ, NOT TYPED (Roadmap 2027 R1, 1 October 2026;
// ROADMAP_2027 Part III-H0; ROADMAP H1, one decisions sheet).
//
// The fortnight that unblocks everything is the owner's eleven acts. A
// checklist the owner ticks goes stale the day it is written, so each act is
// read from the state it changes — the charter row, the sign-in keys' prefix,
// whether the off-machine copy is configured, the stated bills, tax and hour,
// the shop's connection and findability — and an act whose effect Foundry
// cannot see says so instead of claiming either way. It is a reader: it writes
// nothing and reaches nothing outside this machine.
// =============================================================================

const OWNER = 'f_dec';
const ENV = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...over });
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_dec', 'owner@example.com', 'Owner']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const byKey = async (env: NodeJS.ProcessEnv) => Object.fromEntries((await yourDecisions(OWNER, env)).map((d) => [d.key, d]));

describe('the acts', () => {
  it('are all there, in the roadmap\'s order, with subscriptions (PENDING 31), placing offers that still cost minutes (PENDING 32) and printable files (PENDING 41), the price floor (PENDING 44) and the channels (PENDING 43) before the charter', async () => {
    expect((await yourDecisions(OWNER, ENV())).map((d) => d.key)).toEqual(
      ['credentials', 'clerk', 'copy_away', 'witness', 'money', 'sentry', 'phone', 'pending', 'refunds', 'stripe_events', 'money_switch', 'correspondence', 'subscriptions', 'front_loaded_attention', 'printables', 'price_floor', 'channels', 'charter', 'findable']);
  });

  it('say "cannot see" for what Foundry cannot see, never done', async () => {
    const d = await byKey(ENV());
    for (const k of ['credentials', 'witness', 'phone', 'pending', 'refunds']) expect(d[k]!.state, k).toBe('cannot_see');
  });
});

describe('each act is read from the state it changes', () => {
  it('reads the sign-in keys\' instance', async () => {
    expect((await byKey(ENV({ CLERK_SECRET_KEY: 'sk_live_x', CLERK_PUBLISHABLE_KEY: 'pk_live_x' }))).clerk!.state).toBe('done');
    // A fault is open whatever was decided: keys from two instances, or none.
    expect((await byKey(ENV({ CLERK_SECRET_KEY: 'sk_live_x', CLERK_PUBLISHABLE_KEY: 'pk_test_x' }))).clerk!.state).toBe('open');
    expect((await byKey(ENV({}))).clerk!.state).toBe('open');
  });

  it('counts development keys as the owner\'s decision, and says when to revisit it', async () => {
    // PENDING 24, decided 1 October 2026: one owner, so the development
    // instance stays until the phone week or the first sale gives a reason.
    const clerk = (await byKey(ENV({ CLERK_SECRET_KEY: 'sk_test_x', CLERK_PUBLISHABLE_KEY: 'pk_test_x' }))).clerk!;
    expect(clerk.state).toBe('done');
    expect(clerk.act).toBe('Decide which sign-in instance Foundry uses');
    expect(clerk.seen).toContain('development keys, by your decision of 1 October 2026');
    expect(clerk.seen).toContain('after the phone week or the first sale');
  });

  it('reads whether error reports are configured', async () => {
    expect((await byKey(ENV())).sentry!.state).toBe('open');
    expect((await byKey(ENV({ SENTRY_DSN: 'https://k@o.example/1' }))).sentry!.state).toBe('done');
  });

  it('reads the money the owner has stated, and names what is missing', async () => {
    expect((await byKey(ENV())).money).toMatchObject({ state: 'open', seen: 'not yet stated: the monthly bills, a tax assumption, what an hour is worth' });
    const { stateCostLine, stateHourValue } = await import('../../src/services/economy/projection.js');
    await stateCostLine(OWNER, 'fly', 570, 'the Fly invoice');
    await stateHourValue(OWNER, 4000, 9000, 'what other work pays');
    const { setPolicy } = await import('../../src/services/economy/ledger.js');
    await setPolicy({ founderId: OWNER, kind: 'tax_reserve', rateBps: 2500, basis: 'contribution', source: 'my accountant', because: 'a guess', setBy: 'owner' });
    expect((await byKey(ENV())).money!.state).toBe('done');
  });

  it('reads whether a charter is signed', async () => {
    expect((await byKey(ENV())).charter!.state).toBe('open');
  });

  it('reads whether the shop is connected and findable', async () => {
    expect((await byKey(ENV())).findable).toMatchObject({ state: 'open', seen: 'the shop is not connected' });
  });
});

describe('a reader, and nothing more', () => {
  it('writes nothing and reaches nothing outside the machine', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../../src/services/control/decisions.ts'), 'utf8');
    expect(src).not.toMatch(/\b(?:INSERT INTO|UPDATE |DELETE FROM)\b/);
    expect(src).not.toMatch(/\bfetch\(|safeFetch|invoke\(/);
  });

  it('is first on Control', async () => {
    const html = await (await app.request('/foundry/controls')).text();
    const sheet = /<section class="card your-decisions"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(sheet).toContain('Your decisions');
    expect(sheet).toContain('Sign the charter');
    expect(html.indexOf('id="your-decisions"')).toBeLessThan(html.indexOf('id="may-do"'));
  });
});
