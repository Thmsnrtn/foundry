process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { readFileSync } from 'node:fs';
import { getIntegration } from '../../src/services/integration/fabric.js';
import { saveConnectedIntegration } from '../../src/routes/dashboard/integrations.js';

// =============================================================================
// WHICH PAGE THEY USED DECIDED WHETHER IT SYNCED.
//
// `integrations.name` is how the event syncs identify an integration:
// `getIntegration(productId, name)` matches `WHERE product_id = ? AND name = ?`,
// and all six of sentry/linear/intercom/slack/posthog/github call it that way.
// With `name` NULL the lookup returns nothing and every one of them returns
// `{ synced: 0 }` on its FIRST branch — silently, because "not connected" and
// "connected but found nothing" are the same return value.
//
// `POST /integrations/:type/connect` never wrote it. `sync.ts`, the metrics
// path, matches on `type` instead, so THE SAME ROW was visible to one sync and
// invisible to the other. Foundry has two live connect pages, and the sibling
// form at `/agents/integrations` goes through `connectIntegration`, which does
// write `name` — so which page a founder happened to use decided whether their
// integration ever produced a single event.
//
// The two identities are the same string HERE, because this route's `:type`
// param is the provider key. That is not true of every writer, which is why
// migration 199's repair is restricted to the nine values this page can
// produce: `fabric.ts` and `framework.ts` put a CATEGORY in `type`, and
// `connections.ts` puts a direction there. A blanket `SET name = type` would
// have invented integrations called "outbound".
// =============================================================================

const P = 'p_name';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_n2','c_n2','n2@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_n2','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM integrations WHERE product_id = ?', [P]); });

/** THE ACTUAL WRITER `POST /integrations/:type/connect` calls.
 *
 *  The first version of this test built its own INSERT that looked like the
 *  route's. Removing the fix from the route left it green — a test that
 *  reproduces the writer proves only that the test agrees with itself. The
 *  writer is exported now so it can be RUN. */
async function connectViaIntegrationsPage(type: string): Promise<void> {
  await saveConnectedIntegration({
    productId: P, type, credentialsCiphertext: 'ciphertext', config: {},
  });
}

/** What it used to write. */
async function connectTheOldWay(type: string): Promise<void> {
  await query(
    `INSERT INTO integrations (id, product_id, type, status, credentials_json, config_json)
     VALUES (?, ?, ?, 'active', ?, '{}')`,
    [nanoid(), P, type, 'ciphertext']);
}

/** The selector `sync.ts` uses — matches on `type`, and always worked. */
async function visibleToMetricsSync(type: string): Promise<boolean> {
  const r = await query(
    `SELECT id FROM integrations WHERE product_id = ? AND type = ? AND status IN ('active','error')`,
    [P, type]);
  return r.rows.length === 1;
}

describe('an integration connected on the integrations page', () => {
  it('is findable by the event syncs', async () => {
    await connectViaIntegrationsPage('posthog');

    // This is the exact lookup all six event syncs perform.
    expect(await getIntegration(P, 'posthog')).not.toBeNull();
  });

  it('is findable by the metrics sync too, which it always was', async () => {
    await connectViaIntegrationsPage('posthog');
    expect(await visibleToMetricsSync('posthog')).toBe(true);
  });

  it('was visible to one sync and invisible to the other before', async () => {
    await connectTheOldWay('linear');

    // The row is there, connected, with credentials — and the six event syncs
    // return zero for it on their first branch.
    expect(await visibleToMetricsSync('linear')).toBe(true);
    expect(await getIntegration(P, 'linear')).toBeNull();
  });
});

describe('the repair, run as the statement the migration actually contains', () => {
  // Migrations run once, before any of this, so planting a row and re-running
  // the FILE is what tests the statement rather than the timing. Read from
  // disk so an edit to the migration moves the test.
  const MIGRATION = readFileSync(
    'src/db/migrations/199_an_integration_with_no_name.sql', 'utf8');

  async function applyTheRepair(): Promise<void> {
    const statement = MIGRATION.split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n').trim();
    await query(statement.replace(/;\s*$/, ''));
  }

  it('names a nameless row this page could have created', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, type, status) VALUES (?, ?, 'posthog', 'active')`,
      [nanoid(), P]);
    expect(await getIntegration(P, 'posthog')).toBeNull();

    await applyTheRepair();

    expect(await getIntegration(P, 'posthog')).not.toBeNull();
  });

  it('does not invent a provider called after a direction', async () => {
    // `connections.ts` writes type='outbound'. A blanket SET name = type would
    // make `getIntegration(p, 'outbound')` resolve — an integration named
    // after a direction, which no sync is looking for and every sync would
    // then have to ignore.
    await query(
      `INSERT INTO integrations (id, product_id, provider, type, status)
       VALUES (?, ?, 'mcp', 'outbound', 'active')`, [nanoid(), P]);

    await applyTheRepair();

    expect(await getIntegration(P, 'outbound')).toBeNull();
  });

  it('leaves a row another writer already named alone', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, name, type, status)
       VALUES (?, ?, 'sentry', 'inbound', 'active')`, [nanoid(), P]);

    await applyTheRepair();

    expect(await getIntegration(P, 'sentry')).not.toBeNull();
    expect(await getIntegration(P, 'inbound')).toBeNull();
  });
});
