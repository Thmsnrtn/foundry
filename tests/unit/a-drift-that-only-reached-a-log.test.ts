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

/**
 * WHEN AN OBSERVATION WAS MADE, RELATIVE TO NOW — because the reader is.
 *
 * These fixtures were absolute dates in August. `getSelfCheckStanding` only
 * reads the last thirty days, on the stated ground that a check nobody has
 * verified in a month is not the current standing of anything — so on
 * 19 September the fixtures silently aged out of the window and three tests
 * began failing, having asserted nothing about the window and everything about
 * the calendar. A test of a relative reader dates its facts relatively.
 */
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString();
/** The day the card prints for an observation that many days ago. */
const dayOf = (iso: string): string => iso.slice(0, 10);

describe('the latest word on each check is the one that counts', () => {
  it('reports a check whose most recent observation failed', async () => {
    await observe('failed', 'the snapshot omits 2 objects the migrations create', daysAgo(2));
    const failing = await getFailingSelfChecks(P);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({
      check: CHECK, detail: 'the snapshot omits 2 objects the migrations create',
    });
  });

  it('a check that failed and then passed is not failing', async () => {
    // Reporting every failure that ever happened would make a fixed problem
    // permanent, which is the opposite of what this card is for.
    await observe('failed', 'drifted', daysAgo(3));
    await observe('passed', 'the snapshot describes the migrations', daysAgo(2));
    expect(await getFailingSelfChecks(P)).toEqual([]);
  });

  it('a check that passed and then failed IS failing', async () => {
    await observe('passed', 'fine', daysAgo(3));
    await observe('failed', 'drifted again', daysAgo(1));
    expect(await getFailingSelfChecks(P)).toHaveLength(1);
  });

  it('the clock is when it was OBSERVED, not when the row was written', async () => {
    // Both rows are written now; the later observation is the later fact.
    await observe('failed', 'drifted', daysAgo(2));
    await observe('passed', 'fine', daysAgo(1));
    expect(await getFailingSelfChecks(P)).toEqual([]);
  });

  it('two different checks are two different answers', async () => {
    await observe('failed', 'drifted', daysAgo(2));
    await observe('passed', 'fine', daysAgo(2), 'effects-inventory-freshness');
    const failing = await getFailingSelfChecks(P);
    expect(failing.map((f) => f.check)).toEqual([CHECK]);
  });

  it('a company with no observations has nothing to say', async () => {
    expect(await getFailingSelfChecks(P)).toEqual([]);
  });

  it('and a failure nobody has looked at in over a month is not current standing', async () => {
    // The window is the reader's whole argument — "a check nobody has verified
    // in a month is not the current standing of anything" — and it had no test
    // saying so. What it had instead were fixtures that drifted across it by
    // the calendar, which is how the rule was discovered: by three unrelated
    // assertions failing one morning.
    await observe('failed', 'drifted a long time ago', daysAgo(40));
    expect(await getFailingSelfChecks(P)).toEqual([]);
    expect(await letterPage()).not.toContain('Something I keep for you has drifted');

    // The same failure, looked at recently, is current standing.
    await observe('failed', 'drifted a long time ago', daysAgo(1));
    expect(await getFailingSelfChecks(P)).toHaveLength(1);
  });
});

async function letterPage(): Promise<string> {
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
    const when = daysAgo(2);
    await observe('failed', 'the snapshot omits 2 objects the migrations create', when);
    const page = await letter();
    expect(page).toContain('Something I keep for you has drifted');
    expect(page).toContain('the snapshot omits 2 objects the migrations create');
    expect(page).toContain(dayOf(when));
  });

  it('promises no repair, because the observer does not repair', async () => {
    // The observation module runs no command and writes no file, deliberately.
    // A card implying otherwise would claim a capability the path refuses.
    await observe('failed', 'drifted', daysAgo(2));
    const page = await letter();
    expect(page).toMatch(/I have not changed anything/i);
    expect(page.toLowerCase()).not.toMatch(/i have fixed|i will fix|repairing/);
  });

  it('is silent when nothing has drifted', async () => {
    await observe('passed', 'fine', daysAgo(2));
    expect(await letter()).not.toContain('Something I keep for you has drifted');
  });
});
