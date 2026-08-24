process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  MAX_STORED_CUSTOM_KEYS, mergeCustomMetrics,
} from '../../src/services/metrics/custom-metrics.js';

// =============================================================================
// ONE COLUMN, THREE WRITERS, ONE OF WHICH READ IT FIRST.
//
// `metric_snapshots.custom_metrics` holds everything that is not a named metric
// column, and three live paths wrote it:
//
//   integrations/linear.ts     read the day's value, merged its two keys in,
//                              wrote the result. The only one doing that.
//   integrations/framework.ts  wrote {commits_7d, deploys_recent} over whatever
//                              was there. Hourly, via scp_integration_fabric_sync.
//   routes/ingest/index.ts     wrote the caller's `custom` over whatever was
//                              there. Whenever the founder's pipeline posts.
//
// So for a company with both integrations, `custom_metrics.linear_velocity_7d`
// was destroyed within the hour, every hour — while `syncLinearMetrics`
// returned `metricsUpdated: ['custom_metrics.linear_velocity_7d']` and the sync
// log recorded a success. What a company could read back was decided by which
// writer ran last.
//
// The merge is one function now. So is the bound, and it is applied AFTER the
// merge: merging without re-bounding turns a twenty-key-per-request cap into an
// unbounded growth path.
// =============================================================================

const P = 'p_custom';
const TOKEN = 'ingest_token_custom_metrics';
const TODAY = new Date().toISOString().slice(0, 10);

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_cm','c_cm','cm@example.com')");
  await query(
    "INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES (?,'Acme','f_cm','active',?)",
    [P, TOKEN],
  );
  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  app = new Hono();
  app.route('/', ingestRoutes);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots WHERE product_id = ?', [P]); });

const post = (body: unknown): Promise<Response> => app.request(`/ingest/${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function stored(): Promise<Record<string, unknown>> {
  const r = await query(
    'SELECT custom_metrics FROM metric_snapshots WHERE product_id = ? AND snapshot_date = ?',
    [P, TODAY]);
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row?.custom_metrics) return {};
  return JSON.parse(String(row.custom_metrics)) as Record<string, unknown>;
}

async function writeAs(patch: Record<string, unknown>): Promise<void> {
  const merge = await mergeCustomMetrics(P, TODAY, patch);
  if ('refused' in merge) throw new Error(merge.refused);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, custom_metrics)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, snapshot_date) DO UPDATE SET custom_metrics = ?`,
    [`cm_${Object.keys(patch).join('_')}`, P, TODAY, merge.json, merge.json]);
}

describe('three writers of one column no longer erase each other', () => {
  it('an integration keeps what another integration wrote the same day', async () => {
    await writeAs({ linear_velocity_7d: 12, linear_last_sync: '2026-08-24T00:00:00Z' });
    await writeAs({ commits_7d: 40, deploys_recent: 3 });

    expect(await stored()).toMatchObject({
      linear_velocity_7d: 12, commits_7d: 40, deploys_recent: 3,
    });
  });

  it('the founder posting custom metrics keeps what the integrations wrote', async () => {
    await writeAs({ linear_velocity_7d: 12 });
    const res = await post({ custom: { warehouse_units: 900 } });
    expect(res.status).toBe(200);

    const after = await stored();
    expect(after.warehouse_units).toBe(900);
    expect(after.linear_velocity_7d).toBe(12);
  });

  it('and the integrations keep what the founder posted', async () => {
    await post({ custom: { warehouse_units: 900 } });
    await writeAs({ commits_7d: 40 });

    expect(await stored()).toMatchObject({ warehouse_units: 900, commits_7d: 40 });
  });

  it('a second post of the same key overwrites that key and only that key', async () => {
    await post({ custom: { warehouse_units: 900, pallets: 3 } });
    await post({ custom: { warehouse_units: 950 } });

    expect(await stored()).toEqual({ warehouse_units: 950, pallets: 3 });
  });
});

describe('the bound is applied to what would be stored', () => {
  it('a merge past the stored ceiling is refused, not truncated', async () => {
    const first: Record<string, unknown> = {};
    for (let i = 0; i < MAX_STORED_CUSTOM_KEYS; i++) first[`k${i}`] = i;
    await writeAs(first);

    const merge = await mergeCustomMetrics(P, TODAY, { one_too_many: 1 });
    expect('refused' in merge).toBe(true);
    if ('refused' in merge) expect(merge.refused).toMatch(/stored limit/);
  });

  it('a refused merge leaves the stored object exactly as it was', async () => {
    const first: Record<string, unknown> = {};
    for (let i = 0; i < MAX_STORED_CUSTOM_KEYS; i++) first[`k${i}`] = i;
    await writeAs(first);

    const res = await post({ custom: { one_too_many: 1 } });
    expect(res.status).toBe(422);
    expect(Object.keys(await stored())).toHaveLength(MAX_STORED_CUSTOM_KEYS);
  });

  it('a request over the per-request cap is refused before any merge', async () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) many[`r${i}`] = i;
    const res = await post({ custom: many });
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toMatch(/per request/);
  });

  it('a stored value that is not an object does not lose the incoming patch', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, custom_metrics)
       VALUES ('cm_bad', ?, ?, 'not json at all')`, [P, TODAY]);
    const merge = await mergeCustomMetrics(P, TODAY, { still_here: 1 });
    expect('refused' in merge).toBe(false);
    if (!('refused' in merge)) expect(merge.merged).toEqual({ still_here: 1 });
  });
});
