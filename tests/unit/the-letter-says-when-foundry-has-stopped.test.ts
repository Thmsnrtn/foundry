// =============================================================================
// Tests: a founder is told when Foundry has stopped working for them.
//
// A company can stop being operated in ways the founder did not choose and is
// not shown. The entitlement sweep writes `entitlement_paused_at` when a
// subscription lapses, mails them once, and after that the daily surface looks
// exactly like a working one: sections offering to help, permissions to grant,
// questions to answer — all of it refused at execution time by
// `operatingProduct`, and none of it saying so.
//
// The one-off mail is not the answer. A founder who missed it, or whose card
// failed while they were away, opens the letter for a week and reads a working
// institution that is doing nothing.
//
// `companyMayBeChanged` already names the axis, and its four are exactly the
// four that must be told apart: a lapsed subscription, a pause the founder
// chose, an archived record, and a scheduled erasure. The last has its own
// notice; this covers the rest.
//
// FOUNDER UX MAY NOT HIDE UNCERTAINTY, and "am I being helped right now" is the
// least uncertain thing on the page.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'st_owner';
const P = 'st_product';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,?,?,'growth')`,
    [OWNER, 'clerk_st', 'st@test.local']);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Stopped Co',?,'active')`,
    [P, OWNER]);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'st@test.local', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

beforeEach(async () => {
  await query(
    `UPDATE products SET entitlement_paused_at=NULL, scp_status='active', status='active' WHERE id=?`,
    [P]);
});

const page = async (): Promise<string> => (await app.request('/letter')).text();

describe('the letter says when Foundry has stopped', () => {
  it('says nothing while it is working', async () => {
    expect(await page()).not.toContain('I have stopped');
  });

  it('names a lapsed subscription, and offers the way back', async () => {
    await query("UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?", [P]);
    const html = await page();
    expect(html).toContain('I have stopped');
    expect(html, 'the reason must be the one that is true')
      .toContain('the subscription is not active');
    expect(html).toContain('Fix the subscription');
    // And it must not read as data loss, which is what a founder fears here.
    expect(html).toContain('Nothing is lost');
  });

  it('distinguishes a pause the founder chose from a payment that failed', async () => {
    await query("UPDATE products SET scp_status='paused' WHERE id=?", [P]);
    const html = await page();
    expect(html).toContain('you paused it');
    expect(html, 'blaming their card for their own decision is worse than silence')
      .not.toContain('the subscription is not active');
  });

  it('does not tell a stopped company it is on day one', async () => {
    // The first-run welcome is checked before most institutional state and
    // would otherwise replace the notice with "there's no data yet — that's
    // expected on day one", for a company that has been running for months.
    await query("UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?", [P]);
    const html = await page();
    expect(html).toContain('I have stopped');
    expect(html).not.toContain("there's no data yet");
  });
});
