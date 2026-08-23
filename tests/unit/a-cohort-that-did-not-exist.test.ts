process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getCohortBenchmarks } from '../../src/services/network/cohort-patterns.js';
import { lifecycleBandForPrompt, benchmarkSegment } from '../../src/services/benchmarking/pool.js';
import { __loadProductStateForTest as loadProductState } from '../../src/services/network/failure-library.js';

// =============================================================================
// A COHORT THAT DID NOT EXIST, AND A RUNWAY THAT WAS THE CONSTANT 8.
//
// `getCohortBenchmarks` looked up published percentiles with a lifecycle key of
// 'prompt_1'..'prompt_4', derived from the company's FUNDING stage. The only
// writer of `benchmark_percentiles` stores 'pre_revenue' | 'early' | 'growth' |
// 'scale', derived from `current_prompt`. The two vocabularies never
// intersected, so the lookup missed for every company, every time — and the
// code fell through to invented bands (20/40/65 and 15/8/4) written in
// PERCENTAGE POINTS, ranked against metrics stored as 0–1 FRACTIONS. A company
// with five per cent churn was told it was in the top quartile of a cohort that
// had published nothing.
//
// That also walked around the owner's floor: a percentile is published only
// above five distinct contributing companies. An invented distribution has no
// contributors at all.
//
// And the runway: `min(24, (mrr * 2) / (mrr / 4))`. The burn it divides by is
// the MRR it divides, so the expression is 8 for every company with revenue.
// One failure pattern asks for runway under 6 months and could never match;
// another asks for under 9 and always did.
// =============================================================================

const P = 'p_cohort';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ch','c_ch','ch@example.com')");
  await query(
    "INSERT INTO products (id, name, owner_id, status, market_category) VALUES (?,'Acme','f_ch','active','saas')",
    [P]);
  await query(
    "INSERT INTO lifecycle_state (product_id, current_prompt) VALUES (?, 'prompt_6')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM benchmark_percentiles');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM company_financial_position');
});

describe('the segment key', () => {
  it('is the one the pool is written with', async () => {
    expect(lifecycleBandForPrompt('prompt_6')).toBe('growth');
    expect(lifecycleBandForPrompt('prompt_1')).toBe('pre_revenue');
    // Not 'prompt_N': that vocabulary belongs to the lifecycle, not the pool.
    const segment = await benchmarkSegment(P);
    expect(segment.lifecycleState).toBe('growth');
    expect(segment.companyCategory).toBe('b2b_saas');
  });
});

describe('a company whose cohort has published nothing', () => {
  beforeEach(async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate, activation_rate)
       VALUES ('ms_ch', ?, date('now'), 0.05, 0.4)`, [P]);
  });

  it('is not ranked against invented bands', async () => {
    const rows = await getCohortBenchmarks(P);
    const churn = rows.find((r) => r.metric === 'churn_rate');
    expect(churn?.your_value).toBe(0.05);
    expect(churn?.your_percentile, 'no peers, no percentile').toBeNull();
  });

  it('is not shown a distribution nobody contributed to', async () => {
    const rows = await getCohortBenchmarks(P);
    for (const row of rows) {
      expect(row.cohort_p25).toBeNull();
      expect(row.cohort_median).toBeNull();
      expect(row.cohort_p75).toBeNull();
    }
  });

  it('is not told where it sits, either', async () => {
    const rows = await getCohortBenchmarks(P);
    // The insight is a sentence about the rank; with no rank it was handed 50.
    expect(rows.every((r) => r.cohort_insight === null)).toBe(true);
  });
});

describe('a company whose cohort has published percentiles', () => {
  it('is ranked against them, found under the key the writer used', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate)
       VALUES ('ms_ch2', ?, date('now'), 0.05)`, [P]);
    await query(
      `INSERT INTO benchmark_percentiles
         (id, lifecycle_state, company_category, metric_name, p25, p50, p75, p90, sample_count)
       VALUES ('bp_1', 'growth', 'b2b_saas', 'churn_rate', 0.02, 0.06, 0.12, 0.2, 9)`);

    const rows = await getCohortBenchmarks(P);
    const churn = rows.find((r) => r.metric === 'churn_rate');
    expect(churn?.cohort_median).toBe(0.06);
    expect(churn?.your_percentile).not.toBeNull();
    expect(churn?.cohort_insight).not.toBeNull();
  });
});

describe('runway', () => {
  beforeEach(async () => {
    for (const [i, d] of [1, 2, 3, 4].entries()) {
      await query(
        `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, new_mrr_cents)
         VALUES (?, ?, date('now', '-' || ? || ' days'), 4000000, 100000)`,
        [`ms_rw_${i}`, P, d]);
    }
  });

  it('is unknown when the company has not said what its cash is', async () => {
    const signals = await loadProductState(P);
    // Not 8. Foundry cannot derive a bank balance.
    expect(signals.runway_months).toBeNull();
  });

  it('is cash over burn when the company has said', async () => {
    await query(
      `INSERT INTO company_financial_position
         (product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date, stated_by)
       VALUES (?, 9000000, 3000000, date('now'), 'f_ch')`, [P]);

    const signals = await loadProductState(P);
    expect(signals.runway_months).toBe(3);
  });

  it('is unknown when the company says it is burning nothing', async () => {
    await query(
      `INSERT INTO company_financial_position
         (product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date, stated_by)
       VALUES (?, 9000000, 0, date('now'), 'f_ch')`, [P]);

    const signals = await loadProductState(P);
    expect(signals.runway_months).toBeNull();
  });
});

describe('the number on the page', () => {
  it('does not print a 0–1 fraction as if it were already a percentage', async () => {
    const { __fmtMetricForTest: fmt } = await import('../../src/routes/dashboard/network-intelligence.js');
    // Five per cent monthly churn read "0.1%" — a figure a founder would take
    // as extraordinary retention.
    expect(fmt(0.05, 'churn_rate')).toBe('5.0%');
    expect(fmt(0.4, 'activation_rate')).toBe('40.0%');
  });

  it('leaves the metrics that are already in points alone', async () => {
    const { __fmtMetricForTest: fmt } = await import('../../src/routes/dashboard/network-intelligence.js');
    expect(fmt(12.5, 'mrr_growth_rate')).toBe('12.5%');
    expect(fmt(62, 'nps_score')).toBe('62');
    expect(fmt(null, 'churn_rate')).toBe('—');
  });
});
