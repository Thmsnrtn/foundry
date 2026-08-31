process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE INSTITUTION OBSERVED ITSELF, AND THE PAGE SAID THERE WAS NO DATA.
//
// Measured against production, not imagined. The owner established the Foundry
// company at 22:33:48; 76 seconds later `observeFoundryRepositoryReality` wrote
// a real `development_verification` event — 695 schema objects, all described
// by the committed snapshot, `passed` — attributed to that company and durable
// on the volume. Rendering `/letter` against exactly that state produced:
//
//   "Welcome — let's get your first signal. It's empty because there's no data
//    yet — that's expected on day one."
//
// followed by a link to connect Stripe. Three things were wrong at once:
//
//   1. It was false. The institution's first true fact about itself existed.
//   2. A passing check had no surface anywhere. `getFailingSelfChecks` fed a
//      card that only interrupts, so `passed` was reachable by nothing.
//   3. The first-run branch REPLACES the body, and the body is where the report
//      form is. Reporting an obligation is the only intake discovery admits, so
//      the owner could not take the next step even if he knew what it was.
//
// The guard on that branch already carried five overrides, each added when real
// institutional state was found hiding behind it — a waiting customer, a
// support channel, a change Foundry made, a fleet item, a person the company
// recorded. An observation is the sixth, and it is the one the recursion
// starts on.
//
// Nothing here names Foundry. Any company with a development observation gets
// this; Foundry is only the first company to have one.
// =============================================================================

const OWNER = 'sc_owner';
const OBSERVED = 'sc_observed';
// A SECOND ACCOUNT, NOT A SECOND COMPANY. Two companies under one founder puts
// the Letter into fleet chrome, whose own guard suppresses the first-run
// welcome — so a control company kept beside the observed one would have proved
// nothing about the branch under test.
const OTHER_OWNER = 'sc_owner_2';
const UNTOUCHED = 'sc_untouched';

let app: Hono;

const letterFor = async (productId: string, founderId = OWNER) => {
  const res = await app.request('/letter', {
    headers: { cookie: `selected_product=${productId}`, 'x-founder': founderId },
  });
  expect(res.status).toBe(200);
  return res.text();
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?),(?,?,?,?)',
    [OWNER, 'clerk_sc', 'owner@example.com', 'Owner',
      OTHER_OWNER, 'clerk_sc2', 'other@example.com', 'Other']);
  await query(`INSERT INTO products (id,name,owner_id,company_lifecycle_state,scp_status)
    VALUES (?,?,?,'setup','provisioning'),(?,?,?,'setup','provisioning')`,
    [OBSERVED, 'Observed Co', OWNER, UNTOUCHED, 'Untouched Co', OTHER_OWNER]);

  // The production event, copied field for field.
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary,processed)
    VALUES (?,?,'development_verification','development_verified:schema-snapshot-freshness:passed','low',?,?,0)`,
    ['sc_devobs', OBSERVED, JSON.stringify({
      check: 'schema-snapshot-freshness', result: 'passed',
      detail: '695 schema objects, all described by docs/db/schema.snapshot.sql',
      observed_at: '2026-08-31T22:35:04.580Z',
    }), 'schema-snapshot-freshness reported passed']);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: c.req.header('x-founder') ?? OWNER, email: 'owner@example.com' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

describe('a company Foundry has observed', () => {
  it('is not told that it has no data yet', async () => {
    const body = await letterFor(OBSERVED);
    // Matched without the apostrophe: the page escapes it to `&#39;`, and an
    // assertion written the human way passes against any page at all.
    expect(body).not.toContain('no data yet');
    expect(body).not.toContain('get your first signal');
  });

  it('is shown the check that held, what it found, and that nobody asked for it', async () => {
    const body = await letterFor(OBSERVED);
    expect(body).toContain('What I checked about myself');
    expect(body).toContain('schema snapshot freshness');
    expect(body).toContain('695 schema objects');
    // The rung it is actually on. Observing is not carrying, and the card may
    // not imply Foundry is keeping the snapshot fresh — it is not permitted to.
    expect(body).toContain('Nobody has asked me to keep it');
  });

  it('can reach the one intake that would create a responsibility', async () => {
    const body = await letterFor(OBSERVED);
    expect(body).toContain('/letter/company/report');
    // The obligation kind the self-maintenance case needs must be offerable.
    expect(body).toContain('maintenance');
  });
});

describe('a company nothing has observed', () => {
  it('still gets the first-run welcome', async () => {
    const body = await letterFor(UNTOUCHED, OTHER_OWNER);
    expect(body).toContain('Untouched Co');
    expect(body).toContain('get your first signal');
    expect(body).toContain('no data yet');
  });
});

describe('the standing reader', () => {
  it('reports passed and failed alike, and the failure reader is a filter over it', async () => {
    const { getSelfCheckStanding, getFailingSelfChecks } = await import(
      '../../src/services/institution/development-observation.js');

    const standing = await getSelfCheckStanding(OBSERVED);
    expect(standing.map((c) => [c.check, c.result]))
      .toEqual([['schema-snapshot-freshness', 'passed']]);
    expect(await getFailingSelfChecks(OBSERVED)).toEqual([]);

    // A later failure replaces the standing rather than accumulating beside it,
    // and the two readers agree on which observation is current — that shared
    // clock is why they are one function now.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary,processed)
      VALUES (?,?,'development_verification','development_verified:schema-snapshot-freshness:failed','low',?,?,0)`,
      ['sc_devobs_2', OBSERVED, JSON.stringify({
        check: 'schema-snapshot-freshness', result: 'failed',
        detail: '1 object(s) exist but are not in the snapshot: later_table',
        observed_at: '2026-09-01T06:20:00.000Z',
      }), 'schema-snapshot-freshness reported failed']);

    expect((await getSelfCheckStanding(OBSERVED)).map((c) => c.result)).toEqual(['failed']);
    expect((await getFailingSelfChecks(OBSERVED)).map((c) => c.check))
      .toEqual(['schema-snapshot-freshness']);

    // And the page follows: the held card gives way to the one that interrupts.
    const body = await letterFor(OBSERVED);
    expect(body).toContain('Something I keep for you has drifted');
    expect(body).not.toContain('What I checked about myself');
  });
});
