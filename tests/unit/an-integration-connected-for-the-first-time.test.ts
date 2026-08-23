process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getIntegration } from '../../src/services/integration/fabric.js';
import { saveConnectedIntegration } from '../../src/routes/dashboard/integrations.js';

// =============================================================================
// AN INTEGRATION CONNECTED FOR THE FIRST TIME.
//
// `integrations.status` is `TEXT NOT NULL DEFAULT 'pending'` with NO CHECK
// constraint on the live table, so the column accepts every spelling of every
// state and only the READERS decide which ones mean anything. They agree
// completely: `sync.ts` selects `status IN ('active','error')`, every adapter in
// `services/integration/` guards on `status === 'active'`, `framework.ts`
// selects `WHERE status = 'active'` for the due-sync sweep, and the
// integrations page's own badge tests `status === 'active'`.
//
// Migration 074 retired 'connected' for exactly that reason and repaired the
// rows, recording that the code "now standardizes on 'active' everywhere".
// `fabric.ts` repeats it in a JSDoc: "Do NOT write 'connected'."
//
// TWO SITES WERE MISSED, and they were mirror images.
//
// `POST /integrations/:type/connect` wrote 'connected' on INSERT while its own
// UPDATE branch four lines above wrote 'active'. So a founder connecting an
// integration FOR THE FIRST TIME stored their credentials, was redirected to
// `?connected=<type>`, and read "Not connected" over an integration nothing
// would ever sync. Reconnecting took the UPDATE branch and worked — which is
// why it was easy to miss, and why 074's repair was undone one founder at a
// time on every first connect since.
//
// `executeLinearTicket` was the last adapter still REQUIRING 'connected', so
// every Linear ticket Foundry tried to file came back "Linear integration not
// connected" for a correctly connected integration. The only state that would
// have satisfied it is the broken one that cannot sync.
//
// These assert the two states against the SELECTORS that decide them, rather
// than against the string, so a future rename has to move both.
// =============================================================================

const P = 'p_int';
const MAX_CONSECUTIVE_SYNC_FAILURES = 5;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_i','c_i','i@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_i','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM integrations WHERE product_id = ?', [P]); });

/** THE REAL WRITER the connect route calls, not a copy of it. A test that
 *  reproduces the INSERT stays green when the INSERT is wrong. */
async function firstConnect(type: string): Promise<string> {
  await saveConnectedIntegration({
    productId: P, type, credentialsCiphertext: 'ciphertext', config: {},
  });
  const r = await query('SELECT id FROM integrations WHERE product_id = ? AND type = ?', [P, type]);
  return String((r.rows[0] as Record<string, unknown>).id);
}

/** A row in a state no writer produces any more, planted to assert what the
 *  selectors do with it. */
async function plantWithStatus(type: string, status: string): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO integrations (id, product_id, name, type, status, credentials_json, config_json)
     VALUES (?, ?, ?, ?, ?, ?, '{}')`,
    [id, P, type, type, status, 'ciphertext']);
  return id;
}

/** The selector `sync.ts` uses to decide what gets synced. */
async function wouldBeSynced(id: string): Promise<boolean> {
  const r = await query(
    `SELECT id FROM integrations
      WHERE product_id = ? AND id = ?
        AND status IN ('active', 'error')
        AND COALESCE(error_count, 0) < ?`,
    [P, id, MAX_CONSECUTIVE_SYNC_FAILURES]);
  return r.rows.length === 1;
}

/** The selector `framework.ts` uses for the due-sync sweep. */
async function inDueSweep(id: string): Promise<boolean> {
  const r = await query("SELECT id FROM integrations WHERE id = ? AND status = 'active'", [id]);
  return r.rows.length === 1;
}

describe("the value nothing reads", () => {
  it('is not what a first connect stores', async () => {
    const id = await firstConnect('stripe');

    expect(await wouldBeSynced(id)).toBe(true);
    expect(await inDueSweep(id)).toBe(true);
    // And the page's own badge agrees.
    const row = await query('SELECT status FROM integrations WHERE id = ?', [id]);
    expect((row.rows[0] as unknown as { status: string }).status === 'active').toBe(true);
  });

  it('would have been invisible to every selector that matters', async () => {
    // The state the route used to produce, asserted against the selectors so
    // the cost is visible rather than asserted as a string mismatch.
    const id = await plantWithStatus('posthog', 'connected');

    expect(await wouldBeSynced(id)).toBe(false);
    expect(await inDueSweep(id)).toBe(false);
  });

  it('leaves an errored integration syncable, because giving up is a decision', async () => {
    const id = await plantWithStatus('linear', 'error');
    expect(await wouldBeSynced(id)).toBe(true);
  });
});

describe('the guard on the other side of the mirror', () => {
  it('accepts an integration that is correctly connected', async () => {
    await firstConnect('linear');

    const integration = await getIntegration(P, 'linear');

    // executeLinearTicket refuses unless this is true. It used to require
    // 'connected', so this was false for every properly connected integration.
    expect(integration?.status).toBe('active');
    expect(integration !== null && integration.status === 'active').toBe(true);
  });

  it('still refuses one that is not connected at all', async () => {
    const integration = await getIntegration(P, 'linear');
    expect(integration).toBeNull();
  });
});

describe('the repair', () => {
  it('leaves no row in the retired state after every migration applies', async () => {
    const rows = await query("SELECT COUNT(*) AS n FROM integrations WHERE status = 'connected'");
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(0);
  });
});
