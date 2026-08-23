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
  it('names every CREATE that did not run, and each one says so', () => {
    // A `CREATE TABLE IF NOT EXISTS` over a table that already exists is a
    // no-op. A `DROP` followed by a `CREATE` is a rebuild and DID run — the
    // first version of this test counted both and called `network_benchmarks` a
    // trap when migration 086 genuinely rebuilt it. Replay the statements in
    // order and ask which creates met a table that was already there.
    const dir = 'src/db/migrations';
    const live = new Set<string>();
    const noops: Array<{ file: string; table: string }> = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
      const statements =
        /(DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+))|(CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+))|(ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+))/gi;
      for (const m of sql.matchAll(statements)) {
        if (m[2]) { live.delete(m[2].toLowerCase()); continue; }
        if (m[5]) {
          const table = m[5].toLowerCase();
          if (live.has(table)) { if (m[4]) noops.push({ file, table }); }
          else live.add(table);
          continue;
        }
        if (m[7] && m[8]) { live.delete(m[7].toLowerCase()); live.add(m[8].toLowerCase()); }
      }
    }

    // TEN, and this campaign has been bitten by three: `integrations` — created
    // by two later migrations after 008 — cost a cycle; `experiments` carries
    // the union of two designs; `webhook_deliveries` declares a foreign key to
    // a table that was dropped as unused. The list may shrink and must not
    // grow: a new duplicate CREATE is a new file that reads like a schema and
    // will not run.
    expect(noops.map((n) => `${n.table} <- ${n.file}`).sort()).toEqual([
      'api_keys <- 024_rbac.sql',
      'board_packets <- 039_investor_layer.sql',
      'experiments <- 028_growth_experiments.sql',
      'integration_sync_log <- 021_data_ingestion.sql',
      'integrations <- 021_data_ingestion.sql',
      'integrations <- 021_integration_fabric.sql',
      'investor_updates <- 039_investor_layer.sql',
      'outbound_webhooks <- 033_api_webhooks.sql',
      'voice_sessions <- 031_voice_coo.sql',
      'webhook_deliveries <- 033_api_webhooks.sql',
    ]);

    // AND EVERY ONE OF THEM SAYS SO IN THE FILE. A list in a test is read by
    // whoever runs the test; a marker above the statement is read by whoever
    // opens the migration, which is the person about to trust it.
    for (const { file, table } of noops) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const at = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      expect(at, `${file}: ${table} not found`).toBeGreaterThan(-1);
      expect(sql.slice(Math.max(0, at - 700), at),
        `${file}: the CREATE of ${table} does not say it did not run`)
        .toContain('THIS STATEMENT DID NOT RUN');
    }
  });
});
