process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  generateScenariosForProduct, recordCheckpointActual, getForecastAccuracy,
  CHECKPOINT_HORIZON_MONTHS,
} from '../../src/services/scp/forecasting/runway.js';
import { stateFinancialPosition } from '../../src/services/financial/position.js';

// =============================================================================
// A FORECAST NOBODY EVER SCORED — THREE BROKEN LINKS IN ONE LOOP.
//
// `forecast_checkpoints` exists so a prediction can be compared with what
// actually happened. Every link in that loop was broken, in a different way:
//
//   1. The checkpoint was dated TODAY and held today's predicted runway.
//      `recordCheckpointActual` looks up a checkpoint whose date is today, so
//      the only actual it could ever match was one recorded the same day — the
//      prediction compared against itself.
//   2. `recordCheckpointActual` had no caller anywhere, so `actual_value` was
//      never written by anything.
//   3. `variance_pct` was read by nothing, so even a filled-in one was private.
//
// (And the insert that creates the rows had never run at all — seven
// placeholders, six arguments — so there were no checkpoints to break.)
//
// A prediction that is never scored is very easy to keep making. Now: written
// down at one, three and six months, reconciled where a company's real MRR
// arrives, and reported to the founder above the forecasts it judges.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM forecast_checkpoints');
  await query('DELETE FROM forecast_scenarios');
  await query('DELETE FROM company_financial_position');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function companyWithForecasts(): Promise<string> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  const pid = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [pid, 'C', owner]);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, churn_rate)
     VALUES (?,?, date('now'), 500000, 0.02)`, [nanoid(), pid]);
  await stateFinancialPosition({
    productId: pid, cashOnHandDollars: 200_000, monthlyBurnDollars: 20_000,
    asOfDate: new Date().toISOString().slice(0, 10), statedBy: owner,
  });
  await generateScenariosForProduct(pid);
  return pid;
}

describe('a prediction is written down for the date it comes due', () => {
  it('dates checkpoints at their horizon, not at today', async () => {
    const pid = await companyWithForecasts();
    const rows = await query(
      'SELECT checkpoint_date, metric_name FROM forecast_checkpoints WHERE product_id = ?', [pid]);
    expect(rows.rows.length).toBe(CHECKPOINT_HORIZON_MONTHS.length);

    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows.rows as unknown as Array<Record<string, unknown>>) {
      expect(String(r.checkpoint_date), 'a checkpoint dated today compares a prediction with itself')
        .not.toBe(today);
      expect(String(r.checkpoint_date) > today).toBe(true);
      expect(String(r.metric_name)).toBe('mrr_cents');
    }
  });

  it('checkpoints only the base case, not the what-ifs', async () => {
    const pid = await companyWithForecasts();
    const scenarios = await query(
      `SELECT s.name FROM forecast_checkpoints c
         JOIN forecast_scenarios s ON s.id = c.scenario_id
        WHERE c.product_id = ?`, [pid]);
    const names = new Set((scenarios.rows as unknown as Array<Record<string, unknown>>)
      .map((r) => String(r.name)));
    expect([...names], 'scoring a bear case scores a question, not an answer')
      .toEqual(['Base Case']);
  });
});

describe('reality is recorded against it', () => {
  it('fills in the actual and computes the variance', async () => {
    const pid = await companyWithForecasts();
    const due = new Date();
    due.setMonth(due.getMonth() + CHECKPOINT_HORIZON_MONTHS[0]!);
    const dueDate = due.toISOString().slice(0, 10);

    const [row] = (await query(
      'SELECT predicted_value FROM forecast_checkpoints WHERE product_id = ? AND checkpoint_date = ?',
      [pid, dueDate])).rows as unknown as Array<Record<string, unknown>>;
    const predicted = Number(row!.predicted_value);

    // Pretend the month arrived: reality came in 10% under the prediction.
    await query(
      `UPDATE forecast_checkpoints SET checkpoint_date = date('now') WHERE product_id = ?
        AND checkpoint_date = ?`, [pid, dueDate]);
    await recordCheckpointActual(pid, 'mrr_cents', predicted * 0.9);

    const accuracy = await getForecastAccuracy(pid);
    expect(accuracy.resolved).toBe(1);
    expect(accuracy.median_signed_variance_pct, 'ten per cent under').toBeCloseTo(-10, 1);
    expect(accuracy.median_abs_variance_pct).toBeCloseTo(10, 1);
  });

  it('scores nothing when the prediction was zero', async () => {
    const pid = await companyWithForecasts();
    await query(
      `INSERT INTO forecast_checkpoints (id, product_id, checkpoint_date, predicted_value, metric_name)
       VALUES (?, ?, date('now'), 0, 'zero_metric')`, [nanoid(), pid]);

    await recordCheckpointActual(pid, 'zero_metric', 5000);
    const [row] = (await query(
      "SELECT variance_pct FROM forecast_checkpoints WHERE metric_name = 'zero_metric'"))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(row!.variance_pct,
      'a variance of 0 would have scored predicting nothing as a perfect forecast').toBeNull();
  });

  it('is reconciled where a company’s real MRR arrives', () => {
    const src = stripComments(readFileSync('src/routes/ingest/index.ts', 'utf8'),
      { lineComments: true });
    expect(src, 'recordCheckpointActual had no caller anywhere')
      .toMatch(/recordCheckpointActual/);
    expect(src, 'and it must never fail the founder’s ingest')
      .toMatch(/forecast checkpoint reconciliation failed/);
  });
});

describe('and the founder is told', () => {
  it('says nothing has come due rather than reporting perfect accuracy', async () => {
    const pid = await companyWithForecasts();
    const accuracy = await getForecastAccuracy(pid);
    expect(accuracy.resolved).toBe(0);
    expect(accuracy.median_abs_variance_pct, 'unmeasured accuracy is not perfect accuracy')
      .toBeNull();
    expect(accuracy.pending).toBe(CHECKPOINT_HORIZON_MONTHS.length);
  });

  it('reports the direction, not only the size', async () => {
    const pid = await companyWithForecasts();
    for (const over of [1.2, 1.3]) {
      await query(
        `INSERT INTO forecast_checkpoints
           (id, product_id, checkpoint_date, predicted_value, actual_value, variance_pct, metric_name)
         VALUES (?, ?, date('now','-1 day'), 100, ?, ?, 'mrr_cents')`,
        [nanoid(), pid, 100 * over, (over - 1) * 100]);
    }
    const accuracy = await getForecastAccuracy(pid);
    expect(accuracy.median_signed_variance_pct, 'actuals above prediction: forecasts ran low')
      .toBeCloseTo(25, 1);
    expect(accuracy.most_recent.length).toBe(2);
  });

  it('reaches the page above the forecasts it judges', () => {
    const src = readFileSync('src/routes/dashboard/scenarios.ts', 'utf8');
    expect(src).toMatch(/No forecast has come due yet/);
    expect(src).toMatch(/probably optimistic/);
    expect(src).toMatch(/getForecastAccuracy/);
  });

  it('is off the write-only list', () => {
    expect(readFileSync('docs/db/write-only-columns-baseline.txt', 'utf8'))
      .not.toMatch(/forecast_checkpoints\.variance_pct/);
  });
});
