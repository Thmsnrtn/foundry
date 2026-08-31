process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getFinancialPosition, stateFinancialPosition, isStale, STALE_AFTER_DAYS,
} from '../../src/services/financial/position.js';
import { generateScenariosForProduct } from '../../src/services/scp/forecasting/runway.js';
import { computeRunwayModel, analyzeRunwayGap } from '../../src/services/financial/simulator.js';

// =============================================================================
// A RUNWAY FORECAST ABOUT NOBODY'S MONEY.
//
// Foundry has never known any company's cash balance and had no way to be told.
// It computed runway anyway, in two places, by two different inventions:
//
//   scp/forecasting/runway.ts   cash = monthly burn x 12
//                               burn = products.operating_budget_monthly_usd
//   financial/simulator.ts      cash = monthly revenue x 6
//                               burn = 30% of revenue, or $500
//
// So a company would get two different runways depending which page it opened.
//
// The first is the worse of the two, and not only because cash = 12 x burn
// makes the base runway exactly twelve months by construction.
// `operating_budget_monthly_usd` is the AI SPEND CAP and defaults to fifty
// dollars a month (migration 017), so a founder who never touched it was shown
// a business burning $50 a month against $600 of cash.
//
// Those five scenarios then went through a thousand-iteration Monte Carlo, and
// /scenarios rendered a median, a P10–P90 band, and a probability of surviving
// eighteen months. The statistics were real. Every input was invented — and
// that is worse than the bare `runway_months: 999` found on the operator page
// earlier, because nobody mistakes a constant for a finding, and everybody
// reads a confidence interval as one.
//
// A cash balance is a fact about a bank account. The only honest source is the
// person who has one, so migration 181 lets them say, and both paths return
// nothing until they do.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM company_financial_position');
  await query('DELETE FROM forecast_checkpoints');
  await query('DELETE FROM forecast_scenarios');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function addCompany(): Promise<{ productId: string; founderId: string }> {
  const founderId = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [founderId, `clerk_${founderId}`, `${founderId}@example.com`]);
  const productId = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [productId, 'Company', founderId]);
  await query(
    // `mrr_cents` is the LEVEL — where MRR is. `new_mrr_cents` is one period's
    // movement. A company at $5,000/mo reports both; the forecast is seeded from
    // the level, and used to be seeded from a sum of the movements.
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, churn_rate)
     VALUES (?,?, date('now'), 500000, 50000, 0.04)`, [nanoid(), productId]);
  return { productId, founderId };
}

describe('a company that has not said what it has', () => {
  it('gets no scenarios rather than scenarios about invented money', async () => {
    const { productId } = await addCompany();
    expect(await generateScenariosForProduct(productId)).toBeNull();
    const stored = await query('SELECT id FROM forecast_scenarios WHERE product_id = ?', [productId]);
    expect(stored.rows.length, 'nothing modelled, nothing persisted').toBe(0);
  });

  it('gets no runway model from the other implementation either', async () => {
    const { productId, founderId } = await addCompany();
    expect(await computeRunwayModel(founderId, productId)).toBeNull();
  });

  it('is told a gap is unknown rather than safe', async () => {
    const { productId, founderId } = await addCompany();
    const gap = await analyzeRunwayGap(founderId, productId);
    expect(gap.severity, 'it used to answer "safe" with gap_months: 0').toBe('unknown');
    expect(gap.gap_months).toBeNull();
    expect(gap.recommendation).toMatch(/cash on hand and monthly burn/i);
  });

  it('stands down scenarios computed from the old invented figures', async () => {
    const { productId } = await addCompany();
    await query(
      `INSERT INTO forecast_scenarios (id, product_id, name, scenario_type, assumptions_json, results_json, is_active)
       VALUES (?,?, 'Base Case', 'runway', '{}', '{}', 1)`, [nanoid(), productId]);

    await generateScenariosForProduct(productId);
    const active = await query(
      'SELECT id FROM forecast_scenarios WHERE product_id = ? AND is_active = 1', [productId]);
    expect(active.rows.length, 'a stale invented forecast is worse than none').toBe(0);
  });
});

describe('a company that has said', () => {
  it('is modelled from its own numbers', async () => {
    const { productId, founderId } = await addCompany();
    await stateFinancialPosition({
      productId, cashOnHandDollars: 240_000, monthlyBurnDollars: 20_000,
      asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
    });

    const scenarios = await generateScenariosForProduct(productId);
    expect(scenarios).not.toBeNull();
    expect(scenarios!.base_case.runway_months).toBeGreaterThan(0);

    const stored = await query(
      'SELECT assumptions_json FROM forecast_scenarios WHERE product_id = ? AND name = ?',
      [productId, 'Base Case']);
    const assumptions = JSON.parse(
      (stored.rows[0] as Record<string, string>).assumptions_json) as Record<string, number>;
    expect(assumptions.cash_balance_cents, 'theirs, not 12x a spend cap').toBe(24_000_000);
    expect(assumptions.current_burn_cents).toBe(2_000_000);
  });

  it('gets one answer, not two, from the two implementations', async () => {
    const { productId, founderId } = await addCompany();
    await stateFinancialPosition({
      productId, cashOnHandDollars: 100_000, monthlyBurnDollars: 10_000,
      asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
    });

    const model = await computeRunwayModel(founderId, productId);
    expect(model!.cash_on_hand, 'was revenue x 6 here and burn x 12 over there').toBe(100_000);
    expect(model!.monthly_burn).toBe(10_000);
  });

  it('is told the money is not running out rather than given 999 months', async () => {
    const { productId, founderId } = await addCompany();
    // Revenue $5,000/mo from the snapshot; burn $100/mo.
    await stateFinancialPosition({
      productId, cashOnHandDollars: 50_000, monthlyBurnDollars: 100,
      asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
    });
    const model = await computeRunwayModel(founderId, productId);
    expect(model!.runway_months, 'eighty-three years was being stored as a number').toBeNull();
  });
});

describe('the position itself', () => {
  it('records who said so and when it was true', async () => {
    const { productId, founderId } = await addCompany();
    await stateFinancialPosition({
      productId, cashOnHandDollars: 1000, monthlyBurnDollars: 100,
      asOfDate: '2026-06-01', statedBy: founderId,
    });
    const p = await getFinancialPosition(productId, new Date('2026-08-20T00:00:00Z'));
    expect(p!.statedBy).toBe(founderId);
    expect(p!.asOfDate).toBe('2026-06-01');
    expect(p!.daysOld).toBe(80);
    expect(isStale(p!), `80 days is inside ${STALE_AFTER_DAYS}`).toBe(false);
  });

  it('is marked stale rather than quietly presented as current', async () => {
    const { productId, founderId } = await addCompany();
    await stateFinancialPosition({
      productId, cashOnHandDollars: 1000, monthlyBurnDollars: 100,
      asOfDate: '2026-01-01', statedBy: founderId,
    });
    const p = await getFinancialPosition(productId, new Date('2026-08-20T00:00:00Z'));
    expect(isStale(p!)).toBe(true);
  });

  it('refuses a negative amount at the database rather than clamping it', async () => {
    const { productId } = await addCompany();
    await expect(query(
      `INSERT INTO company_financial_position
         (product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date)
       VALUES (?, -1, 100, date('now'))`, [productId]))
      .rejects.toThrow(/cash and burn are amounts/);
  });

  it('refuses a position dated in the future', async () => {
    const { productId } = await addCompany();
    await expect(query(
      `INSERT INTO company_financial_position
         (product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date)
       VALUES (?, 100, 100, date('now','+1 day'))`, [productId]))
      .rejects.toThrow(/not a projection/);
  });

  it('has no default anywhere in the accessor', () => {
    const src = stripComments(
      readFileSync('src/services/financial/position.ts', 'utf8'), { lineComments: true });
    expect(src, 'a default cash balance is a claim about a bank account')
      .not.toMatch(/cash_on_hand_cents.*\?\?\s*\d/);
    expect(src).not.toMatch(/monthly_burn_cents.*\?\?\s*\d/);
  });
});

describe('a reported zero is a report', () => {
  it('does not overwrite a reported churn rate of zero with an invented 3%', async () => {
    const { productId, founderId } = await addCompany();
    await query('DELETE FROM metric_snapshots');
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, churn_rate)
       VALUES (?,?, date('now'), 500000, 50000, 0)`, [nanoid(), productId]);
    await stateFinancialPosition({
      productId, cashOnHandDollars: 100_000, monthlyBurnDollars: 10_000,
      asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
    });

    await generateScenariosForProduct(productId);
    const stored = await query(
      'SELECT assumptions_json FROM forecast_scenarios WHERE product_id = ? AND name = ?',
      [productId, 'Base Case']);
    const assumptions = JSON.parse(
      (stored.rows[0] as Record<string, string>).assumptions_json) as Record<string, number>;
    expect(assumptions.churn_rate,
      '`rate > 0 ? rate : 0.03` overrode a measurement, not just an absence').toBe(0);
  });
});

describe('a statement that had never once run', () => {
  // Found because a test called the function for the first time. The insert
  // carried seven placeholders and six arguments, `generated_by` is NOT NULL,
  // and both callers swallow the throw — so the nightly job logged "Generated
  // scenarios for 0 products" every night and the page never showed a scenario
  // this function produced.
  it('persists what it modelled', async () => {
    const { productId, founderId } = await addCompany();
    await stateFinancialPosition({
      productId, cashOnHandDollars: 100_000, monthlyBurnDollars: 10_000,
      asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
    });
    await generateScenariosForProduct(productId);

    const stored = await query(
      'SELECT name, generated_by FROM forecast_scenarios WHERE product_id = ? AND is_active = 1',
      [productId]);
    expect(stored.rows.length, 'five scenarios, none of which ever reached the table').toBe(5);
    for (const row of stored.rows as unknown as Array<Record<string, unknown>>) {
      expect(row.generated_by).toBe('system');
    }
  });

  it('records the checkpoints, which also never ran', async () => {
    const { productId, founderId } = await addCompany();
    await stateFinancialPosition({
      productId, cashOnHandDollars: 100_000, monthlyBurnDollars: 10_000,
      asOfDate: new Date().toISOString().slice(0, 10), statedBy: founderId,
    });
    await generateScenariosForProduct(productId);

    // One per horizon for the base case — not one per scenario. The what-ifs
    // are deliberately unscored; `a-forecast-nobody-ever-scored.test.ts` holds
    // that rule and the reason for it. What this test is for is unchanged:
    // before the argument count was fixed, no checkpoint reached the table at
    // all, because the insert above it raised first.
    const checkpoints = await query(
      'SELECT metric_name FROM forecast_checkpoints WHERE product_id = ?', [productId]);
    expect(checkpoints.rows.length, 'zero before the insert was fixed').toBe(3);
  });
});

describe('the invented inputs are gone from the source', () => {
  it('no longer reads the AI spend cap as a company’s burn', () => {
    const src = stripComments(
      readFileSync('src/services/scp/forecasting/runway.ts', 'utf8'), { lineComments: true });
    expect(src).not.toMatch(/operating_budget_monthly_usd/);
    expect(src, 'cash = 12 x burn made runway twelve months by construction')
      .not.toMatch(/monthlyBurnCents \* 12/);
  });

  it('no longer estimates cash from revenue', () => {
    const src = stripComments(
      readFileSync('src/services/financial/simulator.ts', 'utf8'), { lineComments: true });
    expect(src).not.toMatch(/monthlyRevenue \* 6/);
    expect(src).not.toMatch(/monthlyRevenue \* 0\.3/);
    expect(src, 'profitable is not eighty-three years of runway').not.toMatch(/999/);
  });

  it('names the assumptions it does still make', () => {
    const src = readFileSync('src/services/scp/forecasting/runway.ts', 'utf8');
    expect(src).toMatch(/export const DEFAULT_CHURN_ASSUMPTION = 0\.03;/);
    expect(src).toMatch(/export const DEFAULT_GROWTH_ASSUMPTION = 0\.05;/);
  });

  it('asks the founder on the page rather than guessing behind it', () => {
    const src = readFileSync('src/routes/dashboard/scenarios.ts', 'utf8');
    expect(src).toMatch(/Runway needs two numbers only you have/);
    expect(src).toMatch(/it will not guess/);
    expect(src).toMatch(/POST[\s\S]{0,200}scenarios\/financial-position/);
  });
});
