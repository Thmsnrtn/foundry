process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { lifecycleBandForPrompt, benchmarkSegment } from '../../src/services/benchmarking/pool.js';
import { __loadProductStateForTest as loadProductState } from '../../src/services/network/failure-library.js';

// =============================================================================
// A COHORT THAT DID NOT EXIST, AND A RUNWAY THAT WAS THE CONSTANT 8.
//
// THE COHORT HALF OF THIS IS GONE WITH ITS SUBJECT. `network/cohort-patterns.ts`
// was deleted as production-dead, so the two describes that held
// `getCohortBenchmarks` to the published percentiles were removed with it. What
// survives is the SEGMENT KEY it was looking up under — `benchmarking/pool.ts`
// still writes and reads that vocabulary — and the runway, which lives in
// `network/failure-library.ts`. The original account is kept because the key is
// the thing still being asserted:
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
