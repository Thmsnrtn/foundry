process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { generateScenariosForProduct } from '../../src/services/scp/forecasting/runway.js';
import { computeRunwayModel } from '../../src/services/financial/simulator.js';
import { stateFinancialPosition } from '../../src/services/financial/position.js';

// =============================================================================
// A FORECAST SEEDED WITH NET NEW BUSINESS.
//
// Two independent forecasters, both seeded with the wrong quantity, in the two
// places a founder goes to ask whether the company survives.
//
// `metric_snapshots.mrr_cents` is where MRR IS. `new_/expansion_/contraction_/
// churned_mrr_cents` are how it MOVED in one period. The runway forecaster
// selected only the four movements and summed them across the eight most recent
// rows, calling the result `current_mrr_cents`; the financial simulator summed
// ONE period's four and called it `monthly_revenue`. Neither ever read the
// level, which sat in the same rows.
//
// A COMPANY REPORTING THROUGH THE DOCUMENTED DOOR WAS MODELLED AT ZERO. The
// `mrr` → `mrr_cents` ingest path leaves the movement columns alone, and those
// columns are INTEGER DEFAULT 0 — not NULL — so the `?? 0` fallbacks never
// fired and the sum was a confident zero. A going concern at $50k MRR with
// $60k burn and $600k cash was told ten months of runway instead of sixty, and
// "Monthly revenue: $0" went verbatim into a model prompt asking for a recovery
// plan.
//
// THE GROWTH RATES WERE THE SAME ERROR TWICE MORE. The runway forecaster grew
// the level by the change in the MOVEMENT — a company whose net new MRR went
// from $10k to $12k was modelled as growing 20% a month whatever its revenue.
// The simulator grew `new + expansion`, only the positive half of a movement,
// and raised the ratio to `1 / (rows - 1)`, treating each snapshot as one
// month. Snapshots are written daily, so six rows spanning five days had a
// five-day change reported as a five-MONTH compound rate. Both now measure the
// level across the window the dates actually describe.
//
// The rule was already written down in this repository, in the forecast
// reconciliation at `routes/ingest/index.ts`: a projection of a LEVEL must not
// be scored against a sum of MOVEMENTS. That was the consuming half. This is
// the producing half of the same sentence.
// =============================================================================

async function company(): Promise<{ productId: string; founderId: string }> {
  const founderId = `f_${nanoid(8)}`;
  const productId = `p_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [founderId, `c_${founderId}`, `${founderId}@example.com`]);
  await query('INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,?)',
    [productId, 'Acme', founderId, 'active']);
  await stateFinancialPosition({
    productId, cashOnHandDollars: 600_000, monthlyBurnDollars: 60_000,
    asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
  });
  return { productId, founderId };
}

/** `daysAgo` back from today. `level` null means the company reported movements
 *  only — or, for a placeholder row, nothing at all. */
async function snapshot(productId: string, daysAgo: number, opts: {
  level?: number | null; newMrr?: number; churn?: number;
}): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, churn_rate)
     VALUES (?,?, date('now', ?), ?, ?, ?)`,
    [nanoid(), productId, `-${daysAgo} days`,
     opts.level ?? null, opts.newMrr ?? 0, opts.churn ?? null],
  );
}

// Every test builds its own company, so nothing is shared and nothing needs
// clearing between them — `metric_snapshots` has children that a blanket DELETE
// would trip over anyway.
beforeAll(async () => { await runMigrations(); });

async function assumptionsOf(productId: string, name: string): Promise<Record<string, number>> {
  const r = await query(
    `SELECT assumptions_json FROM forecast_scenarios
      WHERE product_id = ? AND name = ? AND is_active = 1`, [productId, name]);
  return JSON.parse((r.rows[0] as unknown as { assumptions_json: string }).assumptions_json);
}

describe('the runway forecaster', () => {
  it('seeds the forecast with the level, not eight periods of net new business', async () => {
    const { productId } = await company();
    // $50,000/mo MRR. The movements say $2,000 of that arrived this period.
    await snapshot(productId, 0, { level: 5_000_000, newMrr: 200_000, churn: 0.02 });

    expect(await generateScenariosForProduct(productId)).not.toBeNull();

    const base = await assumptionsOf(productId, 'Base Case');
    expect(base.current_mrr_cents).toBe(5_000_000);
  });

  it('refuses to forecast a company that has only reported movements', async () => {
    const { productId } = await company();
    // Eight periods of net new business and no level anywhere. This used to
    // model the company at the sum: $16,000 of MRR for a business whose actual
    // revenue Foundry has never been told.
    for (let d = 0; d < 8; d++) await snapshot(productId, d, { level: null, newMrr: 200_000 });

    expect(await generateScenariosForProduct(productId)).toBeNull();
    const rows = await query(
      'SELECT COUNT(*) AS n FROM forecast_scenarios WHERE product_id = ? AND is_active = 1', [productId]);
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('stands down forecasts it can no longer justify', async () => {
    const { productId } = await company();
    await snapshot(productId, 0, { level: 5_000_000, churn: 0.02 });
    await generateScenariosForProduct(productId);
    const before = await query(
      'SELECT COUNT(*) AS n FROM forecast_scenarios WHERE product_id = ? AND is_active = 1', [productId]);
    expect((before.rows[0] as unknown as { n: number }).n).toBeGreaterThan(0);

    // The company stops reporting a level. A stale forecast built on a figure
    // Foundry can no longer justify is worse than none.
    await query('DELETE FROM metric_snapshots WHERE product_id = ?', [productId]);
    await snapshot(productId, 0, { level: null, newMrr: 200_000 });
    expect(await generateScenariosForProduct(productId)).toBeNull();

    const after = await query(
      'SELECT COUNT(*) AS n FROM forecast_scenarios WHERE product_id = ? AND is_active = 1', [productId]);
    expect((after.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('grows the level, over the window the dates describe', async () => {
    const { productId } = await company();
    // The level rose 10% across exactly thirty days, so monthly growth is 10%.
    // The MOVEMENT fell over the same window; the old arithmetic would have
    // read that as shrinking.
    await snapshot(productId, 30, { level: 5_000_000, newMrr: 400_000, churn: 0.02 });
    await snapshot(productId, 0, { level: 5_500_000, newMrr: 100_000, churn: 0.02 });

    await generateScenariosForProduct(productId);

    const base = await assumptionsOf(productId, 'Base Case');
    expect(base.mrr_growth_rate).toBeCloseTo(0.1, 6);
  });

  it('normalises a fortnight of growth to a month rather than calling it monthly', async () => {
    const { productId } = await company();
    // +10% across fifteen days is ~21% a month, not 10%.
    await snapshot(productId, 15, { level: 5_000_000, churn: 0.02 });
    await snapshot(productId, 0, { level: 5_500_000, churn: 0.02 });

    await generateScenariosForProduct(productId);

    const base = await assumptionsOf(productId, 'Base Case');
    expect(base.mrr_growth_rate).toBeCloseTo(Math.pow(1.1, 2) - 1, 6);
  });

  it('reads past a placeholder snapshot to the level the company last reported', async () => {
    const { productId } = await company();
    await snapshot(productId, 3, { level: 5_000_000, churn: 0.02 });
    // The daily job writes a row carrying nothing but a date.
    await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date)
                 VALUES (?, ?, date('now'))`, [nanoid(), productId]);

    await generateScenariosForProduct(productId);

    const base = await assumptionsOf(productId, 'Base Case');
    expect(base.current_mrr_cents).toBe(5_000_000);
  });
});

describe('the financial simulator', () => {
  it('reports the level as monthly revenue, not one period of movement', async () => {
    const { productId, founderId } = await company();
    await snapshot(productId, 0, { level: 5_000_000, newMrr: 200_000 });

    const model = await computeRunwayModel(founderId, productId);

    expect(model?.monthly_revenue).toBe(50_000);
  });

  it('does not read a placeholder row as zero revenue', async () => {
    const { productId, founderId } = await company();
    await snapshot(productId, 2, { level: 5_000_000 });
    await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date)
                 VALUES (?, ?, date('now'))`, [nanoid(), productId]);

    const model = await computeRunwayModel(founderId, productId);

    // $50k revenue against $60k burn on $600k cash is sixty months, not ten.
    expect(model?.monthly_revenue).toBe(50_000);
    expect(model?.runway_months).toBeCloseTo(60, 6);
  });

  it('refuses rather than modelling a company whose revenue it was never told', async () => {
    const { productId, founderId } = await company();
    await snapshot(productId, 0, { level: null, newMrr: 200_000 });

    expect(await computeRunwayModel(founderId, productId)).toBeNull();
  });
});
