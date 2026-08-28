process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getFailingSelfChecks, recordDevelopmentObservation,
} from '../../src/services/institution/development-observation.js';

// =============================================================================
// A DRIFT THAT ONLY REACHED A LOG.
//
// When Foundry observes that its own schema snapshot no longer describes the
// migrations that produce it, the observation IS recorded — a
// `development_verification` signal event that feeds Shadowing. But the fact
// that a check about this company is failing RIGHT NOW went to `logger.warn`
// and stopped there.
//
// `every-gate-runs.test.ts` states the identical lesson about job failures: "a
// week in which the institution's loops threw on every run looked exactly like
// a calm week on the page the founder reads". That reasoning produced
// `job_health` and the loops-stopped card. It was never applied to Foundry's
// observations of itself — which is the one company whose repository Foundry
// can independently see, and therefore the only one that has any.
//
// GENERIC BY CONSTRUCTION. Nothing in the reader or the card names Foundry.
// =============================================================================

const P = 'p_selfcheck';
const OWNER = 'f_sc';
const CHECK = 'schema-snapshot-freshness';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_sc', 'sc@example.com']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme',?,'active')",
    [P, OWNER]);
});

beforeEach(async () => {
  await query("DELETE FROM signal_events WHERE product_id=? AND source='development_verification'", [P]);
});

const observe = (result: string, detail: string, observedAt: string, check = CHECK) =>
  recordDevelopmentObservation({ productId: P, check, result, detail, observedAt: new Date(observedAt) });

describe('the latest word on each check is the one that counts', () => {
  it('reports a check whose most recent observation failed', async () => {
    await observe('failed', 'the snapshot omits 2 objects the migrations create',
      '2026-08-20T09:00:00.000Z');
    const failing = await getFailingSelfChecks(P);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({
      check: CHECK, detail: 'the snapshot omits 2 objects the migrations create',
    });
  });

  it('a check that failed and then passed is not failing', async () => {
    // Reporting every failure that ever happened would make a fixed problem
    // permanent, which is the opposite of what this card is for.
    await observe('failed', 'drifted', '2026-08-20T09:00:00.000Z');
    await observe('passed', 'the snapshot describes the migrations', '2026-08-21T09:00:00.000Z');
    expect(await getFailingSelfChecks(P)).toEqual([]);
  });

  it('a check that passed and then failed IS failing', async () => {
    await observe('passed', 'fine', '2026-08-20T09:00:00.000Z');
    await observe('failed', 'drifted again', '2026-08-22T09:00:00.000Z');
    expect(await getFailingSelfChecks(P)).toHaveLength(1);
  });

  it('the clock is when it was OBSERVED, not when the row was written', async () => {
    // Both rows are written now; the later observation is the later fact.
    await observe('failed', 'drifted', '2026-08-22T09:00:00.000Z');
    await observe('passed', 'fine', '2026-08-23T09:00:00.000Z');
    expect(await getFailingSelfChecks(P)).toEqual([]);
  });

  it('two different checks are two different answers', async () => {
    await observe('failed', 'drifted', '2026-08-22T09:00:00.000Z');
    await observe('passed', 'fine', '2026-08-22T09:00:00.000Z', 'effects-inventory-freshness');
    const failing = await getFailingSelfChecks(P);
    expect(failing.map((f) => f.check)).toEqual([CHECK]);
  });

  it('a company with no observations has nothing to say', async () => {
    expect(await getFailingSelfChecks(P)).toEqual([]);
  });
});

describe('it reaches the founder, which a log never did', () => {
  async function letter(): Promise<string> {
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'sc@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    return (await app.request('/letter')).text();
  }

  it('says what drifted and when it last looked', async () => {
    await observe('failed', 'the snapshot omits 2 objects the migrations create',
      '2026-08-20T09:00:00.000Z');
    const page = await letter();
    expect(page).toContain('Something I keep for you has drifted');
    expect(page).toContain('the snapshot omits 2 objects the migrations create');
    expect(page).toContain('2026-08-20');
  });

  it('promises no repair, because the observer does not repair', async () => {
    // The observation module runs no command and writes no file, deliberately.
    // A card implying otherwise would claim a capability the path refuses.
    await observe('failed', 'drifted', '2026-08-20T09:00:00.000Z');
    const page = await letter();
    expect(page).toMatch(/I have not changed anything/i);
    expect(page.toLowerCase()).not.toMatch(/i have fixed|i will fix|repairing/);
  });

  it('is silent when nothing has drifted', async () => {
    await observe('passed', 'fine', '2026-08-20T09:00:00.000Z');
    expect(await letter()).not.toContain('Something I keep for you has drifted');
  });
});
