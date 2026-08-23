process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { assessMAReadiness, getLatestMAScore } from '../../src/services/scp/exit/ma-readiness.js';

// =============================================================================
// A QUARTER OF THE M&A READINESS SCORE WAS A CONSTANT.
//
// `customer_concentration_score` carries weight 0.25 — joint-heaviest with
// revenue quality — in the number a founder is shown when asking whether their
// company is ready to be acquired. Both of its inputs were dead:
//
//   * `topCustomerMrrPct` was a hardcoded `null`, under a comment saying
//     per-customer MRR is not in the schema. It is, in both customer stores.
//   * `customerCount` read `metric_snapshots.customer_count`, a column that has
//     never existed in any migration, so `?? 0` made it zero for every company.
//
// Count zero took the scorer's "no data" branch, 5.0, every time — a fixed
// number with its own score bar beside four measured dimensions, and its `< 7`
// test then printed "Customer concentration risk — reduce dependency on top
// customers" as a finding about the company when it was a finding about the
// data.
//
// What must now be true: the dimension moves with the customers, it is NULL
// rather than middling when no paying customer is known, the overall score
// renormalises over the dimensions it actually had, and the gap sentence says
// which of the two things is missing.
// =============================================================================

const P = 'p_ma';
const P2 = 'p_ma_empty';

async function addCustomer(product: string, id: string, mrrCents: number) {
  await query(
    `INSERT INTO customers (id, product_id, owner_id, external_id, name, mrr_cents)
     VALUES (?, ?, 'f_ma', ?, ?, ?)`,
    [id, product, id, id, mrrCents],
  );
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ma','c_ma','ma@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_ma','active')", [P]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Quiet','f_ma','active')", [P2]);
});

beforeEach(async () => {
  await query('DELETE FROM customers');
  await query('DELETE FROM customer_intelligence');
  await query('DELETE FROM ma_readiness_scores');
});

describe('the concentration dimension', () => {
  it('is not a constant: it moves with the customers this company has', async () => {
    // One customer taking 80% of the revenue is single-customer risk.
    await addCustomer(P, 'c_whale', 800_000);
    await addCustomer(P, 'c_small', 200_000);
    const concentrated = await assessMAReadiness(P);
    expect(concentrated.customer_concentration_score).toBe(1.0);

    // The same company, spread across ten equal customers, is not.
    await query('DELETE FROM customers');
    for (let i = 0; i < 10; i++) await addCustomer(P, `c_even_${i}`, 100_000);
    const spread = await assessMAReadiness(P);
    expect(spread.customer_concentration_score).toBe(9.0);

    // The point of the test, stated directly: the old code returned 5.0 for
    // both of these, and for every other company.
    expect(concentrated.customer_concentration_score)
      .not.toBe(spread.customer_concentration_score);
  });

  it('reads the store a company that integrated properly writes to', async () => {
    // `customer_intelligence` is what `POST /api/v1/customers` writes. A
    // concentration score computed from `customers` alone would be blind to it.
    await query(
      `INSERT INTO customer_intelligence (id, product_id, external_customer_id, mrr_cents)
       VALUES ('ci_1', ?, 'ext_1', 900000), ('ci_2', ?, 'ext_2', 100000)`,
      [P, P],
    );
    const score = await assessMAReadiness(P);
    expect(score.customer_concentration_score).toBe(1.0);
  });

  it('is NULL — not 5.0 — when no paying customer is known', async () => {
    const score = await assessMAReadiness(P2);
    expect(score.customer_concentration_score).toBeNull();
  });

  it('does not score a company from its customer count alone', async () => {
    // Fifty customers whose MRR nobody has told Foundry. The version this
    // replaces scored that 8.0 — "many customers = lower concentration risk" —
    // an estimate displayed as a measurement.
    for (let i = 0; i < 50; i++) await addCustomer(P2, `c_free_${i}`, 0);
    const score = await assessMAReadiness(P2);
    expect(score.customer_concentration_score).toBeNull();
  });
});

describe('the overall score', () => {
  it('renormalises over the dimensions it actually had', async () => {
    const score = await assessMAReadiness(P2);
    expect(score.customer_concentration_score).toBeNull();

    const measured =
      score.revenue_quality_score * 0.25 +
      score.ip_clarity_score * 0.15 +
      score.team_retention_score * 0.20 +
      score.integration_complexity_score * 0.15;
    expect(score.overall_score).toBeCloseTo(measured / 0.75, 1);

    // Not the un-renormalised sum, which is what treating the absence as a
    // zero would produce.
    expect(score.overall_score).not.toBeCloseTo(measured, 1);
  });

  it('counts a measured dimension at its full weight', async () => {
    await addCustomer(P, 'c_only', 500_000);
    const score = await assessMAReadiness(P);
    expect(score.customer_concentration_score).toBe(1.0);
    const total =
      score.revenue_quality_score * 0.25 +
      score.ip_clarity_score * 0.15 +
      score.team_retention_score * 0.20 +
      score.integration_complexity_score * 0.15 +
      1.0 * 0.25;
    expect(score.overall_score).toBeCloseTo(total, 1);
  });
});

describe('the gap it reports', () => {
  it('states a gap in Foundry’s records as a gap in Foundry’s records', async () => {
    const score = await assessMAReadiness(P2);
    const gaps = score.key_gaps.join(' | ');
    expect(gaps).toContain('Foundry knows of no paying customers');
    expect(gaps).not.toContain('reduce dependency on top customers');
  });

  it('states a real concentration problem as one', async () => {
    await addCustomer(P, 'c_whale', 900_000);
    await addCustomer(P, 'c_small', 100_000);
    const score = await assessMAReadiness(P);
    const gaps = score.key_gaps.join(' | ');
    expect(gaps).toContain('reduce dependency on top customers');
    expect(gaps).not.toContain('Foundry knows of no paying customers');
  });
});

describe('the column', () => {
  it('stores and returns the absence', async () => {
    const written = await assessMAReadiness(P2);
    expect(written.customer_concentration_score).toBeNull();

    const row = (await query(
      'SELECT customer_concentration_score FROM ma_readiness_scores WHERE product_id=?',
      [P2],
    )).rows[0] as unknown as Record<string, unknown>;
    expect(row.customer_concentration_score).toBeNull();

    // And survives the read path, rather than being cast into a number.
    const read = await getLatestMAScore(P2);
    expect(read?.customer_concentration_score).toBeNull();
  });
});

describe('migration 207, on the rows already stored', () => {
  // Every row written before this repair holds exactly 5.0 in this column, and
  // that 5.0 measured nothing — including inside its `overall_score`. The
  // migration's four UPDATE statements are run here against a row shaped like
  // one of those, so the arithmetic that repairs history is itself tested.
  const migration = readFileSync('src/db/migrations/207_a_quarter_of_a_score_that_was_a_constant.sql', 'utf8');
  const updates = migration
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.toUpperCase().startsWith('UPDATE'));

  it('has the four statements this test is about', () => {
    expect(updates).toHaveLength(4);
  });

  it('recomputes the score over the four dimensions that were measured', async () => {
    // 8*0.25 + 6*0.15 + 7*0.20 + 5*0.15 + 5*0.25 = 6.3, the old sum.
    await query(
      `INSERT INTO ma_readiness_scores
         (id, product_id, assessed_at, overall_score, revenue_quality_score,
          ip_clarity_score, team_retention_score, integration_complexity_score,
          customer_concentration_score, ready_to_be_acquired, key_gaps_json)
       VALUES ('ma_old', ?, '2026-01-01', 6.3, 8.0, 6.0, 7.0, 5.0, 5.0, 0, ?)`,
      [P, JSON.stringify([
        'Customer concentration risk — reduce dependency on top customers, target no single customer > 20% of MRR',
      ])],
    );
    for (const stmt of updates) await query(stmt);

    const row = (await query(
      'SELECT * FROM ma_readiness_scores WHERE id=?', ['ma_old'],
    )).rows[0] as unknown as Record<string, unknown>;

    // (8*0.25 + 6*0.15 + 7*0.20 + 5*0.15) / 0.75 = 5.05 / 0.75 = 6.7.
    expect(row.overall_score).toBeCloseTo(6.7, 1);
    expect(row.customer_concentration_score).toBeNull();
    expect(row.ready_to_be_acquired).toBe(0);
    expect(String(row.key_gaps_json)).toContain('Foundry knows of no paying customers');
    expect(String(row.key_gaps_json)).not.toContain('reduce dependency on top customers');
  });

  it('recomputes the acquirable flag from the score it just changed', async () => {
    // 9*0.25 + 9*0.15 + 9*0.20 + 9*0.15 + 5*0.25 = 7.55: over the line only
    // because of the constant. Without it the four measured dimensions average
    // 9.0 — so this row stays acquirable, and for a reason that was measured.
    await query(
      `INSERT INTO ma_readiness_scores
         (id, product_id, assessed_at, overall_score, revenue_quality_score,
          ip_clarity_score, team_retention_score, integration_complexity_score,
          customer_concentration_score, ready_to_be_acquired, key_gaps_json)
       VALUES ('ma_high', ?, '2026-01-01', 7.6, 9.0, 9.0, 9.0, 9.0, 5.0, 1, '[]')`,
      [P],
    );
    // And one the constant was propping up: four measured dimensions at 6.0
    // average 6.0, under the 7.0 line either way, but the flag must be derived
    // rather than carried over.
    await query(
      `INSERT INTO ma_readiness_scores
         (id, product_id, assessed_at, overall_score, revenue_quality_score,
          ip_clarity_score, team_retention_score, integration_complexity_score,
          customer_concentration_score, ready_to_be_acquired, key_gaps_json)
       VALUES ('ma_low', ?, '2026-01-02', 5.75, 6.0, 6.0, 6.0, 6.0, 5.0, 1, '[]')`,
      [P],
    );
    for (const stmt of updates) await query(stmt);

    const rows = (await query(
      'SELECT id, overall_score, ready_to_be_acquired FROM ma_readiness_scores ORDER BY id',
    )).rows as unknown as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.ma_high.overall_score).toBeCloseTo(9.0, 1);
    expect(byId.ma_high.ready_to_be_acquired).toBe(1);
    expect(byId.ma_low.overall_score).toBeCloseTo(6.0, 1);
    expect(byId.ma_low.ready_to_be_acquired).toBe(0);
  });

  it('leaves a row alone whose concentration score was not the constant', async () => {
    await query(
      `INSERT INTO ma_readiness_scores
         (id, product_id, assessed_at, overall_score, revenue_quality_score,
          ip_clarity_score, team_retention_score, integration_complexity_score,
          customer_concentration_score, ready_to_be_acquired, key_gaps_json)
       VALUES ('ma_real', ?, '2026-01-01', 6.3, 8.0, 6.0, 7.0, 5.0, 7.0, 0, '[]')`,
      [P],
    );
    for (const stmt of updates) await query(stmt);

    const row = (await query(
      'SELECT * FROM ma_readiness_scores WHERE id=?', ['ma_real'],
    )).rows[0] as unknown as Record<string, unknown>;
    expect(row.customer_concentration_score).toBe(7.0);
    expect(row.overall_score).toBe(6.3);
  });
});
