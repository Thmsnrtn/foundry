process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// MRR THE LEVEL AND MRR THE MOVEMENT, UNDER ONE NAME.
//
// The founder's own ingest endpoint mapped the field `mrr` to the column
// `new_mrr_cents`. A company POSTing `{"mrr": 50000}` — meaning "our MRR is
// fifty thousand dollars", which is what the word means — had that recorded as
// NEW BUSINESS WON THIS PERIOD, alongside its real expansion, contraction and
// churn figures.
//
// Everything downstream inherited it. `mrr_health_ratio` is computed at ingest
// as churned/new, so a level in the denominator made every such company look
// healthy. The operator's portfolio figure sums new + expansion - contraction -
// churned, and was adding a level to movements. Forge and Oracle put
// `new=$50,000.00` into their prompts.
//
// And `metric_snapshots.mrr_cents` — the column that MEANS the level, and the
// one every investor-facing surface reads — had no writer on this door at all.
// So scp/investor/board-packet.ts, investor-update.ts, fundraising-readiness.ts
// and both briefings showed "N/A" for MRR to any company reporting through the
// founder's own token, while that company's number sat in the wrong column.
//
// Two doors, two meanings for one word: `POST /api/v1/metrics` accepts
// `mrr_cents` and writes the level correctly. The same company reported
// differently depending which door it used.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function companyWithToken(): Promise<{ productId: string; token: string }> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  const productId = `p_${nanoid(8)}`;
  const token = `tok_${nanoid(16)}`;
  await query(
    "INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES (?,?,?,'active',?)",
    [productId, 'C', owner, token]);
  return { productId, token };
}

async function post(token: string, body: Record<string, unknown>) {
  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  return ingestRoutes.request(`/ingest/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function snapshot(productId: string): Promise<Record<string, unknown>> {
  const r = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]);
  return (r.rows[0] ?? {}) as unknown as Record<string, unknown>;
}

describe('the word mrr means the level', () => {
  it('records a reported total as the total', async () => {
    const { productId, token } = await companyWithToken();
    const res = await post(token, { mrr: 52000 });
    expect(res.status).toBe(200);

    const row = await snapshot(productId);
    expect(Number(row.mrr_cents), '$52,000 of MRR').toBe(5_200_000);
    // The column defaults to 0, so "untouched" and "reported as zero" look the
    // same here. What matters is that $52,000 did not land in it.
    expect(Number(row.new_mrr_cents), 'not new business won this period').toBe(0);
  });

  it('keeps the movement separate when both are sent', async () => {
    const { productId, token } = await companyWithToken();
    await post(token, { mrr: 52000, new_mrr: 4500, churned_mrr: 200 });

    const row = await snapshot(productId);
    expect(Number(row.mrr_cents)).toBe(5_200_000);
    expect(Number(row.new_mrr_cents)).toBe(450_000);
    expect(Number(row.churned_mrr_cents)).toBe(20_000);
  });

  it('measures revenue health from the movement, not the level', async () => {
    const { productId, token } = await companyWithToken();
    await post(token, { mrr: 52000, new_mrr: 4500, churned_mrr: 900 });

    const row = await snapshot(productId);
    // churned / new = 900 / 4500 = 0.2. With the level in the denominator it
    // was 900 / 52000 = 0.017, which reads as excellent retention.
    expect(Number(row.mrr_health_ratio)).toBeCloseTo(0.2, 3);
  });

  it('accepts the column name too, already in cents', async () => {
    const { productId, token } = await companyWithToken();
    await post(token, { mrr_cents: 5_200_000 });
    expect(Number((await snapshot(productId)).mrr_cents)).toBe(5_200_000);
  });

  it('does not multiply a cents field by a hundred', async () => {
    const { productId, token } = await companyWithToken();
    await post(token, { mrr_cents: 1000 });
    expect(Number((await snapshot(productId)).mrr_cents), '$10, not $1,000').toBe(1000);
  });
});

describe('the two doors agree', () => {
  it('both write the level to the same column', () => {
    const publicApi = stripComments(readFileSync('src/api/v1/metrics.ts', 'utf8'),
      { lineComments: true });
    expect(publicApi, 'the public API always wrote the level correctly')
      .toMatch(/mrr_cents/);

    const ingest = stripComments(readFileSync('src/routes/ingest/index.ts', 'utf8'),
      { lineComments: true });
    expect(ingest, 'and the founder’s own door does now')
      .toMatch(/mrr:\s*'mrr_cents'/);
    expect(ingest, 'the mapping that made a level into new business')
      .not.toMatch(/^\s*mrr:\s*'new_mrr_cents'/m);
  });
});

describe('a forecast is scored against the quantity it predicted', () => {
  it('reconciles against the level, because the projection is a level', () => {
    const src = stripComments(readFileSync('src/routes/ingest/index.ts', 'utf8'),
      { lineComments: true });
    // monthly_projection.mrr_cents_median is where MRR is expected to BE.
    // The first version of this compared it against a sum of movements.
    expect(src).toMatch(/const mrrIdx = columns\.indexOf\('mrr_cents'\)/);
    expect(src, 'new + expansion - contraction - churned is not a level')
      .not.toMatch(/at\(expansionIdx\) - at\(contractionIdx\)/);
  });

  it('makes no comparison when only movements were reported', async () => {
    const { productId, token } = await companyWithToken();
    await query(
      `INSERT INTO forecast_checkpoints (id, product_id, checkpoint_date, predicted_value, metric_name)
       VALUES (?, ?, date('now'), 5000000, 'mrr_cents')`, [nanoid(), productId]);

    await post(token, { new_mrr: 4500, churned_mrr: 200 });

    const [cp] = (await query(
      'SELECT actual_value FROM forecast_checkpoints WHERE product_id = ?', [productId]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(cp!.actual_value, 'no level was reported, so there is nothing to compare')
      .toBeNull();
  });

  it('compares when the level is reported', async () => {
    const { productId, token } = await companyWithToken();
    await query(
      `INSERT INTO forecast_checkpoints (id, product_id, checkpoint_date, predicted_value, metric_name)
       VALUES (?, ?, date('now'), 5000000, 'mrr_cents')`, [nanoid(), productId]);

    await post(token, { mrr: 52000 });

    const [cp] = (await query(
      'SELECT actual_value, variance_pct FROM forecast_checkpoints WHERE product_id = ?',
      [productId])).rows as unknown as Array<Record<string, unknown>>;
    expect(Number(cp!.actual_value)).toBe(5_200_000);
    expect(Number(cp!.variance_pct), '4% above the prediction').toBeCloseTo(4, 1);
  });
});

describe('the founder is told which is which', () => {
  it('spells out the difference where the example lives', () => {
    const src = readFileSync('src/routes/dashboard/settings.ts', 'utf8');
    expect(src).toMatch(/what you bill in total this month/);
    expect(src).toMatch(/only\s*\n?\s*the part of it that is new business/);
    expect(src, 'the example should show both')
      .toMatch(/"mrr": 52000/);
  });
});
