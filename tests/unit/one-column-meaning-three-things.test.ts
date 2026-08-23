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
beforeEach(async () => { await query('DELETE FROM integrations'); });

describe('the database', () => {
  it('refuses a direction that is not one of the three', async () => {
    await expect(query(
      `INSERT INTO integrations (id, product_id, type, direction, status)
       VALUES ('i_bad', ?, 'stripe', 'sideways', 'active')`, [P]))
      .rejects.toThrow(/direction is inbound, outbound or bidirectional/);
  });

  it('refuses one on update too', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, type, direction, status)
       VALUES ('i_ok', ?, 'stripe', 'inbound', 'active')`, [P]);
    await expect(query("UPDATE integrations SET direction = 'upwards' WHERE id = 'i_ok'"))
      .rejects.toThrow(/direction is inbound, outbound or bidirectional/);
  });

  it('allows null, which is a row the backfill could not classify', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, type, status) VALUES ('i_null', ?, 'mystery', 'active')`,
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
  it('takes inbound and bidirectional rows and leaves outbound alone', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, name, provider, type, direction, status)
       VALUES ('i_in', ?, 'stripe', 'stripe', 'stripe', 'inbound', 'active'),
              ('i_bi', ?, 'github', 'github', 'github', 'bidirectional', 'active'),
              ('i_out', ?, 'weather', 'mcp', 'outbound', 'outbound', 'active'),
              ('i_unknown', ?, 'x', 'x', 'x', NULL, 'active')`, [P, P, P, P]);

    // The query the sync runs, kept in step with `syncProductIntegrations`.
    const rows = await query(
      `SELECT id FROM integrations
        WHERE product_id = ? AND status IN ('active','error')
          AND direction IN ('inbound','bidirectional')
          AND COALESCE(error_count, 0) < 5
        ORDER BY id`, [P]);
    expect((rows.rows as unknown as Array<{ id: string }>).map((r) => r.id))
      .toEqual(['i_bi', 'i_in']);
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
