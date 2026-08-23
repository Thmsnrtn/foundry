process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runSync } from '../../src/services/integrations/framework.js';

// =============================================================================
// AN UPDATE THAT MATCHED NOTHING AND REPORTED SUCCESS.
//
// Two adapters fetched from a provider and then wrote into TODAY'S metric
// snapshot with a bare `UPDATE ... WHERE product_id = ? AND snapshot_date = ?`.
// That row is created by a daily job at midnight UTC — so before that job's
// first run for a company (a company created today), or on any day it failed,
// the UPDATE affected zero rows. The adapter then returned
// `records_processed: N` and `metrics_updated: [...]`, the sync log recorded a
// success, and the integration's health stayed green. Nothing was written.
//
// A write that lands nowhere and answers "done" is the same defect this
// campaign keeps finding one layer down: a failure indistinguishable from a
// quiet success.
// =============================================================================

const P = 'p_upsert';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_up','c_up','up@example.com')");
  await query(
    `INSERT INTO products (id, name, owner_id, status, github_repo_owner, github_repo_name)
     VALUES (?, 'Acme', 'f_up', 'active', 'acme', 'app')`, [P]);
});

beforeEach(async () => {
  // The company has NO snapshot for today: the daily placeholder job has not
  // run for it yet. This is the state the two adapters silently required.
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM integrations');
  await query('DELETE FROM integration_sync_log');
});
afterEach(() => { vi.unstubAllGlobals(); });

const integration = (id: string, provider: string, creds: Record<string, string>) => query(
  `INSERT INTO integrations (id, product_id, provider, type, status, credentials, error_count)
   VALUES (?, ?, ?, ?, 'active', ?, 0)`,
  [id, P, provider, provider, JSON.stringify(creds)]);

describe('the GitHub adapter', () => {
  it('writes the metrics even when today has no snapshot yet', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200,
      json: async () => ([{ sha: 'a' }, { sha: 'b' }]),
      text: async () => '[]',
    }));
    await integration('int_gh', 'github', { access_token: 'ghp_x' });

    const result = await runSync('int_gh', 'scheduled');
    expect(result).not.toBeNull();

    const rows = await query(
      "SELECT custom_metrics FROM metric_snapshots WHERE product_id = ? AND snapshot_date = date('now')", [P]);
    expect(rows.rows, 'the row it claimed to have written').toHaveLength(1);
    const custom = JSON.parse((rows.rows[0] as unknown as { custom_metrics: string }).custom_metrics) as
      { commits_7d: number };
    expect(custom.commits_7d).toBe(2);
  });

  it('updates the row when one already exists, rather than duplicating it', async () => {
    await query(
      "INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents) VALUES ('ms_x', ?, date('now'), 500)",
      [P]);
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, json: async () => ([{ sha: 'a' }]), text: async () => '[]',
    }));
    await integration('int_gh2', 'github', { access_token: 'ghp_x' });

    await runSync('int_gh2', 'scheduled');

    const rows = await query(
      "SELECT mrr_cents, custom_metrics FROM metric_snapshots WHERE product_id = ? AND snapshot_date = date('now')", [P]);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as unknown as { mrr_cents: number; custom_metrics: string };
    expect(Number(row.mrr_cents), 'the existing measurement survives').toBe(500);
    expect(row.custom_metrics).toContain('commits_7d');
  });
});

describe('the Intercom adapter', () => {
  it('writes support volume even when today has no snapshot yet', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, json: async () => ({ total_count: 7 }), text: async () => '{}',
    }));
    await integration('int_ic', 'intercom', { access_token: 'ic_x' });

    await runSync('int_ic', 'scheduled');

    const rows = await query(
      "SELECT support_volume_7d FROM metric_snapshots WHERE product_id = ? AND snapshot_date = date('now')", [P]);
    expect(rows.rows).toHaveLength(1);
    expect(Number((rows.rows[0] as unknown as { support_volume_7d: number }).support_volume_7d)).toBe(7);
  });
});
