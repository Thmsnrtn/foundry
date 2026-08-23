process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { directionOf, DIRECTION_BY_PROVIDER } from '../../src/services/integration/direction.js';

// =============================================================================
// ONE COLUMN MEANING THREE THINGS.
//
// `integrations.type` held a PROVIDER KEY from the connect form, a DIRECTION
// from the fabric and the MCP connect page, and a CATEGORY from the framework
// path. Every reader had to guess which, and three live defects came out of the
// guessing — most visibly an outbound MCP connection dragged into the inbound
// sync until Foundry told the founder it had "stopped syncing outbound": a
// sentence about a direction, announcing that it had given up on something it
// was never meant to pull from.
//
// Migration 203 gives direction its own column, backfills it from what each row
// actually means, and refuses any value outside the three. Every writer sets it;
// the sync selects on it and dispatches on `provider`.
// =============================================================================

const P = 'p_dir';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_d','c_d','d@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_d','active')", [P]);
});
beforeEach(async () => {
  await query('DELETE FROM integrations');
  await query('DELETE FROM integration_sync_log');
});

describe('the database', () => {
  it('refuses a direction that is not one of the three', async () => {
    await expect(query(
      `INSERT INTO integrations (id, product_id, provider, direction, status)
       VALUES ('i_bad', ?, 'stripe', 'sideways', 'active')`, [P]))
      .rejects.toThrow(/direction is inbound, outbound or bidirectional/);
  });

  it('refuses one on update too', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, provider, direction, status)
       VALUES ('i_ok', ?, 'stripe', 'inbound', 'active')`, [P]);
    await expect(query("UPDATE integrations SET direction = 'upwards' WHERE id = 'i_ok'"))
      .rejects.toThrow(/direction is inbound, outbound or bidirectional/);
  });

  it('allows null, which is a row the backfill could not classify', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, provider, status) VALUES ('i_null', ?, 'mystery', 'active')`,
      [P]);
    const row = (await query("SELECT direction FROM integrations WHERE id = 'i_null'"))
      .rows[0] as unknown as { direction: string | null };
    expect(row.direction).toBeNull();
  });
});

describe('which way a provider points', () => {
  it('has one home', () => {
    expect(directionOf('mcp')).toBe('outbound');
    expect(directionOf('stripe')).toBe('inbound');
    expect(directionOf('github')).toBe('bidirectional');
  });

  it('defaults an unknown provider to inbound, the direction that sends nothing', () => {
    expect(directionOf('some_new_thing')).toBe('inbound');
    expect(DIRECTION_BY_PROVIDER.some_new_thing).toBeUndefined();
  });
});

describe('the sync', () => {
  it('attempts inbound and bidirectional rows and leaves outbound alone', async () => {
    // THE REAL FUNCTION, not a copy of its query. A first version of this test
    // restated the SELECT inline and passed with the defect restored — a test
    // that reproduces the code cannot see the code change.
    await query(
      `INSERT INTO integrations (id, product_id, name, provider, direction, status)
       VALUES ('i_in', ?, 'stripe', 'stripe', 'inbound', 'active'),
              ('i_bi', ?, 'github', 'github', 'bidirectional', 'active'),
              ('i_out', ?, 'weather', 'mcp', 'outbound', 'active'),
              ('i_unknown', ?, 'x', 'x', NULL, 'active')`, [P, P, P, P]);

    const { syncProductIntegrations } = await import('../../src/services/integrations/sync.js');
    await syncProductIntegrations(P);

    // Every attempt opens a row in the sync log, whatever it then does.
    const attempted = (await query(
      'SELECT DISTINCT integration_id FROM integration_sync_log WHERE product_id = ? ORDER BY integration_id',
      [P])).rows as unknown as Array<{ integration_id: string }>;
    expect(attempted.map((r) => r.integration_id)).toEqual(['i_bi', 'i_in']);
  });
});

describe('the dispatch', () => {
  it('sends a fabric-written row to its provider, not to its direction', async () => {
    // The row shape the fabric writes. Before migration 204 its `type` held a
    // DIRECTION while `provider` held who it is, so a dispatch on `type` looked
    // for an adapter called 'inbound' and failed the row every cycle, for a
    // provider that has one.
    await query(
      `INSERT INTO integrations (id, product_id, name, provider, direction, status, credentials_json)
       VALUES ('i_fab', ?, 'stripe', 'stripe', 'inbound', 'active', ?)`,
      [P, JSON.stringify({ access_token: 'sk_test' })]);

    const { syncProductIntegrations } = await import('../../src/services/integrations/sync.js');
    await syncProductIntegrations(P);

    const row = (await query(
      "SELECT status, error_message FROM integration_sync_log WHERE integration_id = 'i_fab'"))
      .rows[0] as unknown as { status: string; error_message: string | null };
    // Dispatching on `type` finds no adapter called 'inbound' and fails the
    // row — every cycle, for a provider that has one. The message it writes
    // names `provider ?? type`, so it reads "no adapter for provider 'stripe'":
    // an error that names the thing that would have worked. The status is what
    // separates the two paths.
    expect(row?.status, 'it looked for an adapter named after a direction').toBe('success');
  });
});

describe('the writers', () => {
  it('all set a direction', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    for (const f of [
      'src/services/integration/fabric.ts',
      'src/routes/dashboard/integrations.ts',
      'src/routes/dashboard/connections.ts',
      'src/services/integrations/stripe-sync.ts',
      'src/services/integrations/framework.ts',
    ]) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      const inserts = src.match(/INSERT INTO integrations \(([^)]*)\)/g) ?? [];
      expect(inserts.length, `${f} writes integrations`).toBeGreaterThan(0);
      for (const insert of inserts) {
        expect(insert, `${f}: ${insert}`).toContain('direction');
      }
    }
  });
});
