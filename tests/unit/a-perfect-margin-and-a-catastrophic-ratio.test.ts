process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  computeUnitEconomics, identifyBusinessModelStressors,
} from '../../src/services/intelligence/business-model.js';

// =============================================================================
// A PERFECT MARGIN AND A CATASTROPHIC RATIO, FROM THE SAME MISSING NUMBER.
//
// `avg_cogs_per_customer` and `avg_cac` are optional columns on
// `business_model_profile`; most companies have filled in neither. Every field
// of `UnitEconomics` was non-nullable, so both absences had nowhere to go but
// zero — and zero means something different in each one:
//
//   • COGS 0 makes contribution_margin (arpu − 0) / arpu = 1.0. A PERFECT 100%
//     margin for a company that never said what its costs are, which then
//     multiplies straight into LTV.
//   • CAC 0 makes cac_payback_months 0 — the BEST possible answer — and
//     ltv_cac_ratio 0, the WORST possible answer. Adjacent lines, same missing
//     number, opposite directions.
//
// `GET /api/products/:id/unit-economics` returns this object verbatim behind
// the investor-layer tier gate, so a founder or an investor reading it saw a
// complete unit-economics model: 100% gross margin, zero CAC, zero payback, and
// an LTV:CAC of nought.
//
// THE READERS ALREADY KNEW. `identifyBusinessModelStressors` tests
// `ltv_cac_ratio > 0 && < 3` rather than `< 3` — a reader working around the
// substitution by hand, which is what a value nobody can trust looks like from
// the outside. Stating it in the type is what stops the next reader having to
// remember, and the compiler found every threshold that had been relying on it.
// =============================================================================

const P = 'p_ue';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_u','c_u','u@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_u','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM business_model_profile WHERE product_id = ?', [P]);
  await query('DELETE FROM metric_snapshots WHERE product_id = ?', [P]);
});

/** $50k MRR, 500 active users, 5% monthly churn: ARPU $100, lifetime 20 months. */
async function reportingCompany(): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots
       (id, product_id, snapshot_date, mrr_cents, active_users, churn_rate)
     VALUES (?, ?, date('now'), 5000000, 500, 0.05)`, [nanoid(), P]);
}

async function statesCosts(fields: { cogs?: number; cac?: number }): Promise<void> {
  await query(
    `INSERT INTO business_model_profile
       (id, product_id, owner_id, revenue_model, avg_cogs_per_customer, avg_cac)
     VALUES (?, ?, 'f_u', 'subscription', ?, ?)`,
    [nanoid(), P, fields.cogs ?? null, fields.cac ?? null]);
}

describe('a company that never stated its costs', () => {
  it('is not credited with a perfect margin', async () => {
    await reportingCompany();

    const e = await computeUnitEconomics(P);

    expect(e!.arpu).toBeCloseTo(100, 6);
    expect(e!.cogs_per_customer).toBeNull();
    // 1.0 — a flawless 100% — was the old answer.
    expect(e!.contribution_margin).toBeNull();
    expect(e!.gross_margin).toBeNull();
    // And LTV rests on the margin, so it cannot be stated either.
    expect(e!.ltv).toBeNull();
  });

  it('is not given the best possible payback and the worst possible ratio at once', async () => {
    await reportingCompany();
    await statesCosts({ cogs: 20 });   // margin known, CAC still not

    const e = await computeUnitEconomics(P);

    expect(e!.contribution_margin).toBeCloseTo(0.8, 6);
    expect(e!.ltv).toBeCloseTo(100 * 0.8 * 20, 4);
    expect(e!.cac).toBeNull();
    // Zero months to recover a cost nobody stated, beside a ratio of zero.
    expect(e!.cac_payback_months).toBeNull();
    expect(e!.ltv_cac_ratio).toBeNull();
  });
});

describe('a company that stated them', () => {
  it('gets the whole model', async () => {
    await reportingCompany();
    await statesCosts({ cogs: 20, cac: 400 });

    const e = await computeUnitEconomics(P);

    expect(e!.contribution_margin).toBeCloseTo(0.8, 6);
    expect(e!.ltv).toBeCloseTo(1600, 4);
    expect(e!.cac).toBe(400);
    // $400 to acquire, $80 of margin a month.
    expect(e!.cac_payback_months).toBeCloseTo(5, 4);
    expect(e!.ltv_cac_ratio).toBeCloseTo(4, 4);
  });

  it('still reports a genuinely zero margin as zero', async () => {
    // COGS equal to ARPU is a real finding and must read like one.
    await reportingCompany();
    await statesCosts({ cogs: 100, cac: 400 });

    const e = await computeUnitEconomics(P);

    expect(e!.contribution_margin).toBe(0);
    expect(e!.ltv).toBe(0);
    // No margin to recover the cost from, so there is no payback period.
    expect(e!.cac_payback_months).toBeNull();
  });
});

describe('the stressors that read them', () => {
  it('raises nothing about costs a company never stated', async () => {
    await reportingCompany();

    const items = await identifyBusinessModelStressors(P);

    expect(items.filter((i) => /unit economics|CAC payback|LTV:CAC/i.test(i.name))).toEqual([]);
  });

  it('still raises a real negative margin', async () => {
    await reportingCompany();
    await statesCosts({ cogs: 150 });   // costs more to serve than it earns

    const items = await identifyBusinessModelStressors(P);

    const negative = items.find((i) => i.name === 'Negative unit economics');
    expect(negative).toBeDefined();
    expect(negative!.severity).toBe('critical');
  });

  it('still raises a real LTV:CAC below the bar', async () => {
    await reportingCompany();
    await statesCosts({ cogs: 20, cac: 1600 });   // LTV 1600, ratio 1.0

    const items = await identifyBusinessModelStressors(P);

    expect(items.find((i) => i.name === 'LTV:CAC ratio below threshold')).toBeDefined();
  });
});
