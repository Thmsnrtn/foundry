process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runSync } from '../../src/services/integrations/framework.js';

// =============================================================================
// TWO IDS, ONE CHECKED.
//
// `POST /api/products/:id/integrations/:integrationId/sync` verified that the
// founder owned `:id` — and then passed `:integrationId` to `runSync`, which
// resolved the integration by id alone and synced whatever product and
// credentials that row named.
//
// So the checked identifier decided nothing and the unchecked one decided
// everything. Any founder with a product of their own could name another
// company's integration and make Foundry call a third-party provider with that
// company's stored credentials, write the results into that company's metric
// snapshots, and read the record count and the provider's error text out of the
// response body.
//
// AN INTEGRATION ID IS NOT A CAPABILITY. The ownership rule lived in the route
// while the row it governed was fetched two files away, so the scope now
// travels with the call and is applied to the query that loads the row.
// =============================================================================

const MINE = 'p_mine';
const THEIRS = 'p_theirs';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_a','c_a','a@example.com')");
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_b','c_b','b@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Mine','f_a','active')", [MINE]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Theirs','f_b','active')", [THEIRS]);
});
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM integration_sync_log');
  await query('DELETE FROM integrations');
  await query(
    `INSERT INTO integrations (id, product_id, provider, type, status, credentials, error_count)
     VALUES ('int_theirs', ?, 'stripe', 'stripe', 'active', ?, 0)`,
    [THEIRS, JSON.stringify({ api_key: 'sk_live_theirs' })]);
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Any call to the provider at all is the thing being ruled out. */
function watchTheWire(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return {
      ok: true, status: 200,
      json: async () => ({ data: [] }),
      text: async () => '{}',
    };
  });
  return { calls };
}

describe('a sync named by a founder who does not own the integration', () => {
  it('finds nothing, rather than syncing it', async () => {
    const result = await runSync('int_theirs', { onBehalfOfProduct: MINE });
    expect(result).toBeNull();
  });

  it('never reaches the provider with the other company credentials', async () => {
    const wire = watchTheWire();
    await runSync('int_theirs', { onBehalfOfProduct: MINE });
    expect(wire.calls).toEqual([]);
  });

  it('writes nothing into the other company metrics', async () => {
    watchTheWire();
    await runSync('int_theirs', { onBehalfOfProduct: MINE });

    const snaps = await query('SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id = ?', [THEIRS]);
    expect((snaps.rows[0] as unknown as { n: number }).n).toBe(0);
    const logs = await query('SELECT COUNT(*) AS n FROM integration_sync_log WHERE product_id = ?', [THEIRS]);
    expect((logs.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('does not touch the other company sync status either', async () => {
    watchTheWire();
    await runSync('int_theirs', { onBehalfOfProduct: MINE });

    const row = (await query("SELECT last_sync_at, last_sync_status FROM integrations WHERE id = 'int_theirs'"))
      .rows[0] as unknown as { last_sync_at: string | null; last_sync_status: string | null };
    expect(row.last_sync_at).toBeNull();
    expect(row.last_sync_status).toBeNull();
  });
});

describe('the owner of the integration', () => {
  it('still syncs it', async () => {
    const wire = watchTheWire();
    const result = await runSync('int_theirs', { onBehalfOfProduct: THEIRS });

    expect(result).not.toBeNull();
    expect(wire.calls.length).toBeGreaterThan(0);
  });

  it('and so does the scheduler, which acts for no caller', async () => {
    watchTheWire();
    const result = await runSync('int_theirs', 'scheduled');
    expect(result).not.toBeNull();
  });
});

describe('the route', () => {
  const src = stripComments(readFileSync('src/routes/api/supercharge.ts', 'utf8'), { lineComments: true });

  it('passes the product id it checked, not the one it did not', () => {
    // Comments stripped: the paragraph above the call names both identifiers,
    // and a test that greps source must not read its own explanation as code.
    expect(src).toContain("runSync(integrationId, { onBehalfOfProduct: productId })");
    expect(src).not.toMatch(/runSync\(integrationId\)/);
  });

  it('checks ownership before the sync, not after', () => {
    const check = src.indexOf('getProductByOwner(productId, founder.id)', src.indexOf("integrations/:integrationId/sync"));
    const call = src.indexOf('runSync(integrationId', check);
    expect(check).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(check);
  });
});
