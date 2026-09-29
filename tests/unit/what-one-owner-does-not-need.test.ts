process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, splitSqlStatements } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { tablesToErase, tablesWithProductId } from '../../src/services/privacy/consent.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// WHAT ONE OWNER DOES NOT NEED, KEPT RATHER THAN LOST (Private S7).
//
// The owner ruled on 29 September 2026 that Foundry is theirs alone: "lock it,
// then delete". The door was locked in S2. This is the delete: the jobs that
// served only somebody else stop, their code goes, and the three tables left
// with nothing to read or write them are retired by migration 368 — every row
// copied into `retired_rows` first, so nothing that happened is un-happened.
// =============================================================================

const M368 = readFileSync('src/db/migrations/368_what_one_owner_does_not_need.sql', 'utf8');

// The three tables as the schema had them before 368 (the foreign key to
// products is left out: this database holds only what 368 touches).
const BEFORE = `
CREATE TABLE alignment_snapshots (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL, alignment_score INTEGER NOT NULL, signal_consensus BOOLEAN,
  divergence_areas TEXT, risk_state_consensus BOOLEAN, priority_consensus BOOLEAN, notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(product_id, snapshot_date));
CREATE TABLE benchmark_contributions (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, lifecycle_state TEXT NOT NULL,
  company_category TEXT NOT NULL, team_size_bucket TEXT NOT NULL, mrr_bucket TEXT NOT NULL,
  activation_rate REAL, day_30_retention REAL, churn_rate REAL, nps_score REAL, cac_usd REAL,
  ltv_usd REAL, ai_cost_pct_of_mrr REAL, contributed_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE benchmark_percentiles (
  id TEXT PRIMARY KEY, lifecycle_state TEXT NOT NULL, company_category TEXT NOT NULL,
  metric_name TEXT NOT NULL, p25 REAL, p50 REAL, p75 REAL, p90 REAL,
  sample_count INTEGER NOT NULL, computed_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

describe('migration 368 on a database that has rows', () => {
  const db = createClient({ url: 'file::memory:' });
  const count = async (sql: string): Promise<number> =>
    Number((await db.execute(sql)).rows[0].n);

  beforeAll(async () => {
    for (const s of splitSqlStatements(BEFORE)) await db.execute(s);
    await db.execute(`INSERT INTO alignment_snapshots (id, product_id, snapshot_date, alignment_score, notes)
      VALUES ('al1','p_a','2026-09-01',72,'two founders, one view'), ('al2','p_b','2026-09-01',40,NULL)`);
    await db.execute(`INSERT INTO benchmark_contributions (id, product_id, lifecycle_state, company_category,
      team_size_bucket, mrr_bucket, churn_rate) VALUES ('bc1','p_a','early','b2b_saas','1','0-1k',0.05)`);
    await db.execute(`INSERT INTO benchmark_percentiles (id, lifecycle_state, company_category, metric_name,
      p25, p50, p75, sample_count) VALUES ('bp1','early','b2b_saas','churn_rate',0.02,0.04,0.06,7)`);
    for (const s of splitSqlStatements(M368)) await db.execute(s);
  });

  it('keeps every row it drops, one for one', async () => {
    expect(await count("SELECT COUNT(*) n FROM retired_rows WHERE table_name='alignment_snapshots'")).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM retired_rows WHERE table_name='benchmark_contributions'")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM retired_rows WHERE table_name='benchmark_percentiles'")).toBe(1);
  });

  it('keeps each row whole, so it can be restored by hand', async () => {
    const r = (await db.execute(
      "SELECT product_id, row_json FROM retired_rows WHERE table_name='alignment_snapshots' AND product_id='p_a'")).rows[0];
    expect(JSON.parse(String(r.row_json))).toMatchObject({
      id: 'al1', product_id: 'p_a', snapshot_date: '2026-09-01', alignment_score: 72, notes: 'two founders, one view',
    });
    const pct = (await db.execute(
      "SELECT product_id, row_json FROM retired_rows WHERE table_name='benchmark_percentiles'")).rows[0];
    expect(pct.product_id, 'an aggregate names no company').toBeNull();
    expect(JSON.parse(String(pct.row_json))).toMatchObject({ p50: 0.04, sample_count: 7 });
  });

  it('drops the three tables', async () => {
    const left = (await db.execute(`SELECT name FROM sqlite_master WHERE type='table'
      AND name IN ('alignment_snapshots','benchmark_contributions','benchmark_percentiles')`)).rows;
    expect(left).toEqual([]);
  });

  it('does not let a retired row be edited', async () => {
    await expect(db.execute("UPDATE retired_rows SET row_json='{}'")).rejects.toThrow(/kept as they were/);
  });
});

describe('the retired rows stay under the ordinary erasure', () => {
  beforeAll(async () => { await runMigrations(); });

  it('is found by the table walk every company erasure and export uses', async () => {
    expect(await tablesWithProductId()).toContain('retired_rows');
    expect(await tablesToErase()).toContain('retired_rows');
  });

  it('is migrated in the real chain, and the three tables are gone there too', async () => {
    const t = (await query(`SELECT name FROM sqlite_master WHERE type='table'
      AND name IN ('retired_rows','alignment_snapshots','benchmark_contributions','benchmark_percentiles')`)).rows
      .map((r) => String((r as Record<string, unknown>).name));
    expect(t).toEqual(['retired_rows']);
  });
});

describe('the jobs that served somebody else', () => {
  it('are not scheduled', () => {
    for (const gone of ['welcome_sequence_tick', 'slot_enforcement', 'alignment_scores',
      'network_contribution', 'network_radar']) {
      expect(Object.keys(JOB_REGISTRY), gone).not.toContain(gone);
    }
  });
});
