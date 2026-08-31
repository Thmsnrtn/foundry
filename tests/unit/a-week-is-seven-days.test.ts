process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { __loadProductStateForTest } from '../../src/services/network/failure-library.js';

// =============================================================================
// A WEEK IS SEVEN DAYS, NOT ONE ROW.
//
// The failure-pattern matcher counted "weeks of declining activation" and
// "weeks of MRR growth below 2%" by stepping through consecutive
// `metric_snapshots` rows. The table is keyed by DATE and most companies report
// daily, so four consecutive DAYS matched the Activation Decay pattern — which
// tells the founder they have a 60-day lead time on a failure. The MRR
// comparison called `snapshots[3]` "the 4-week-ago snapshot", three rows back,
// and compared `new_mrr_cents`: the revenue ACQUIRED in a period, not the
// company's revenue.
// =============================================================================

const P = 'p_week';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_week','c_week','w@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_week','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function snap(offset: number, cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date${keys.map((k) => `, ${k}`).join('')})
     VALUES (?, ?, ?${keys.map(() => ', ?').join('')})`,
    [`ms_${offset}`, P, daysAgo(offset), ...keys.map((k) => cols[k])],
  );
}

describe('weeks of declining activation', () => {
  it('are not four days of it', async () => {
    // Four consecutive days, each lower than the last. Under the old counter
    // this was "activation declining for 4 weeks" and matched a pattern.
    for (let d = 0; d < 4; d++) await snap(d, { activation_rate: 0.30 + d * 0.02 });

    const state = await __loadProductStateForTest(P);
    expect(state.activation_declining_weeks).toBe(0);
  });

  it('are counted when the weeks are there', async () => {
    // Weekly reporter. `w` counts BACKWARDS in time, so a rate that rises with
    // `w` is one that has been falling week by week: 0.40 five weeks ago down
    // to 0.30 today.
    for (let w = 0; w <= 5; w++) await snap(w * 7, { activation_rate: 0.30 + w * 0.02 });

    const state = await __loadProductStateForTest(P);
    expect(state.activation_declining_weeks).toBeGreaterThanOrEqual(4);
  });

  it('are not counted when activation is rising', async () => {
    // 0.20 five weeks ago up to 0.30 today.
    for (let w = 0; w <= 5; w++) await snap(w * 7, { activation_rate: 0.30 - w * 0.02 });
    const state = await __loadProductStateForTest(P);
    expect(state.activation_declining_weeks).toBe(0);
  });
});

describe('the four-week MRR growth rate', () => {
  it('compares the level four weeks apart', async () => {
    await snap(28, { mrr_cents: 1_000_000 });
    await snap(0, { mrr_cents: 1_200_000 });

    const state = await __loadProductStateForTest(P);
    expect(state.mrr_growth_rate).toBeCloseTo(20, 1);
  });

  it('is unknown when the company has no history four weeks back', async () => {
    await snap(1, { mrr_cents: 1_000_000 });
    await snap(0, { mrr_cents: 1_200_000 });

    const state = await __loadProductStateForTest(P);
    expect(state.mrr_growth_rate, 'yesterday is not four weeks ago').toBeNull();
  });

  it('is not computed from the movement columns', async () => {
    // A company reporting acquisition but never a level.
    await snap(28, { new_mrr_cents: 100_000 });
    await snap(0, { new_mrr_cents: 300_000 });

    const state = await __loadProductStateForTest(P);
    expect(state.mrr_growth_rate).toBeNull();
  });
});

describe('weeks of MRR growth below 2%', () => {
  it('are weeks', async () => {
    for (let w = 0; w <= 6; w++) await snap(w * 7, { mrr_cents: 1_000_000 });
    const state = await __loadProductStateForTest(P);
    expect(state.mrr_growth_weeks).toBeGreaterThanOrEqual(5);
  });

  it('are not counted for a company growing fast', async () => {
    // 10% a week, so the oldest week is the smallest: `w` counts backwards.
    for (let w = 0; w <= 6; w++) await snap(w * 7, { mrr_cents: Math.round(1_000_000 * 1.1 ** (6 - w)) });
    const state = await __loadProductStateForTest(P);
    expect(state.mrr_growth_weeks).toBe(0);
  });
});
