process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// WHEN TWO MIGRATIONS CREATE THE SAME TABLE, ONLY THE FIRST ONE IS THE SCHEMA.
//
// `CREATE TABLE IF NOT EXISTS` over an existing table does nothing. Migration
// 033 creates `webhook_deliveries` with `webhook_id REFERENCES outbound_webhooks`
// and a `payload_json TEXT NOT NULL`; migration 006 had already created it with
// `webhook_id REFERENCES webhooks` and no such column. The live table is 006's,
// plus the columns later ALTERs added — so 033 reads like a schema and is a
// proposal, and anyone building on its text is building on something that never
// ran.
//
// `outbound_webhooks` was the same story twice over: created by 013, created
// again by 033, written by nothing. Foundry sends webhooks two ways and both
// are real — `webhooks` for the documented API and `product_webhooks` for the
// dashboard's Slack/Linear/Notion targets — so a third table named for the
// concept was a place for the next person to write code nothing would read.
// Migration 206 dropped it.
//
// This test pins the LIVE shapes, so a future reader who trusts the wrong file
// finds out here rather than in production.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('webhook_deliveries', () => {
  it('references the table its rows actually name', async () => {
    const row = (await query(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='webhook_deliveries'"))
      .rows[0] as unknown as { sql: string } | undefined;
    const ddl = String(row?.sql ?? '');
    expect(ddl).toContain('REFERENCES webhooks(id)');
    expect(ddl, 'the FK migration 033 proposed never took effect').not.toContain('outbound_webhooks');
  });

  it('accepts a delivery for a webhook created through the documented API', async () => {
    await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_wh','c_wh','wh@example.com')");
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_wh','A','f_wh','active')");
    await query(
      `INSERT INTO webhooks (id, founder_id, product_id, url, events, secret)
       VALUES ('wh_1','f_wh','p_wh','https://example.test/hook','[]','s')`);

    await query(
      `INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, effect_certainty)
       VALUES ('wd_1','wh_1','risk_state.changed',200,'provider_acknowledged')`);

    const rows = await query("SELECT id FROM webhook_deliveries WHERE webhook_id = 'wh_1'");
    expect(rows.rows).toHaveLength(1);
  });
});

describe('the third table', () => {
  it('is gone', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='outbound_webhooks'");
    expect(rows.rows).toHaveLength(0);
  });

  it('and the two real ones are both still here, because both are used', async () => {
    for (const table of ['webhooks', 'product_webhooks']) {
      const rows = await query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
      expect(rows.rows, `${table} is a live webhook path`).toHaveLength(1);
    }
  });
});

describe('the shape of the trap', () => {
  it('names every table created by more than one migration', () => {
    // Not a failure — a list. Each of these has a file that reads like a schema
    // and did not run, and `experiments` is the other one this campaign has
    // been bitten by. Anything new here is a place where the same mistake is
    // available.
    const dir = 'src/db/migrations';
    const creators = new Map<string, string[]>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
      for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
        const name = m[1];
        if (name.endsWith('_new')) continue;            // table rebuilds, by design
        creators.set(name, [...(creators.get(name) ?? []), file]);
      }
    }
    const twice = [...creators.entries()].filter(([, files]) => files.length > 1)
      .map(([name]) => name).sort();
    // ELEVEN, and this campaign has been bitten by three of them: `integrations`
    // (`outbound_webhooks` stays on the list even though migration 206 drops
    // the table: the two CREATE statements are still in the history, and this
    // counts files rather than live tables.)
    // (created by THREE migrations), `experiments`, and `webhook_deliveries`.
    // The number may shrink and must not grow: a new duplicate CREATE is a new
    // file that reads like a schema and will not run.
    expect(twice, 'a table created twice: only the first CREATE is the schema').toEqual([
      'api_keys',
      'board_packets',
      'experiments',
      'integration_sync_log',
      'integrations',
      'investor_updates',
      'network_benchmarks',
      'network_contributions',
      'outbound_webhooks',
      'voice_sessions',
      'webhook_deliveries',
    ]);
  });
});
