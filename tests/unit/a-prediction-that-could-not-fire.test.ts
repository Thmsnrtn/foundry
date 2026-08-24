process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { generatePredictions } from '../../src/services/intelligence/predictive.js';

// =============================================================================
// A PREDICTION THAT COULD NOT FIRE, AND ONE ABOUT THE WRONG NUMBER.
//
// `predictChurnSpike` compared a change in `churn_rate` — stored 0–1 in this
// system — against a threshold of 0.5 written in PERCENTAGE POINTS. Churn would
// have had to jump fifty points between snapshots, so the prediction could
// never fire for anyone; and its evidence lines printed a three-point rise as
// "+0.03%".
//
// `predictRevenuePlateau` read `new_mrr_cents + expansion_mrr_cents` — the
// revenue ACQUIRED in a period, not the company's revenue — divided consecutive
// rows without regard to the gap between their dates, and compared the result
// against 5% and −2%, which are monthly figures. It then said "MRR will plateau
// within 60-90 days". Its deceleration test also ran the wrong way down a
// newest-first array, so it fired on ACCELERATING growth.
// =============================================================================

const P = 'p_pred';
const OWNER = 'f_pred';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'c_pred','pred@example.com')", [OWNER]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme',?,'active')", [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM predictions');
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function snap(dayOffset: number, cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date${keys.map((k) => `, ${k}`).join('')})
     VALUES (?, ?, ?${keys.map(() => ', ?').join('')})`,
    [`ms_${dayOffset}`, P, daysAgo(dayOffset), ...keys.map((k) => cols[k])],
  );
}

describe('the churn spike prediction', () => {
  it('fires on a real acceleration in a 0-1 churn rate', async () => {
    // 2% → 3% → 5% → 9%: the recent jump is about 3 points a snapshot against
    // about 1 before it. In fractions those deltas are 0.03 and 0.01, and the
    // threshold is 0.5 — fifty points — so this used to be silence.
    await snap(120, { churn_rate: 0.02 });
    await snap(90, { churn_rate: 0.03 });
    await snap(60, { churn_rate: 0.05 });
    await snap(30, { churn_rate: 0.09 });

    const predictions = await generatePredictions(P, OWNER);
    const churn = predictions.find((p) => p.prediction_type === 'churn_spike');
    expect(churn, 'a company whose churn is accelerating was told nothing').toBeTruthy();
    expect(churn!.evidence.join(' ')).toContain('points per snapshot');
    expect(churn!.evidence.join(' ')).not.toMatch(/\+0\.0\d%/);
  });

  it('stays quiet when churn is steady', async () => {
    for (const d of [120, 90, 60, 30]) await snap(d, { churn_rate: 0.03 });
    const predictions = await generatePredictions(P, OWNER);
    expect(predictions.find((p) => p.prediction_type === 'churn_spike')).toBeUndefined();
  });
});

describe('the revenue plateau prediction', () => {
  it('reads the MRR level and the gap between the dates', async () => {
    // Monthly snapshots, growth decelerating: 8% → 4% → 2% → 1%.
    const mrrs = [1_000_000, 1_080_000, 1_123_200, 1_145_664, 1_157_121];
    for (let i = 0; i < mrrs.length; i++) await snap(150 - i * 30, { mrr_cents: mrrs[i]! });
    // Two more so there are at least six rows and four rates.
    await snap(15, { mrr_cents: 1_162_000 });

    const predictions = await generatePredictions(P, OWNER);
    const plateau = predictions.find((p) => p.prediction_type === 'revenue_plateau');
    expect(plateau, 'a decelerating company was told nothing').toBeTruthy();
    expect(plateau!.evidence.join(' ')).toContain('%/month');
  });

  it('does not call an accelerating company a plateau', async () => {
    // 1% → 2% → 4% → 8%: growth is speeding up. The deceleration test used to
    // run the wrong way down a newest-first array and called this a plateau.
    const mrrs = [1_000_000, 1_010_000, 1_030_200, 1_071_408, 1_157_121, 1_260_000];
    for (let i = 0; i < mrrs.length; i++) await snap(180 - i * 30, { mrr_cents: mrrs[i]! });

    const predictions = await generatePredictions(P, OWNER);
    expect(predictions.find((p) => p.prediction_type === 'revenue_plateau')).toBeUndefined();
  });

  it('says nothing when the level was never reported', async () => {
    // Movement only — which is what this prediction used to read.
    for (let i = 0; i < 6; i++) {
      await snap(180 - i * 30, { new_mrr_cents: 50_000, expansion_mrr_cents: 10_000 });
    }
    const predictions = await generatePredictions(P, OWNER);
    expect(predictions.find((p) => p.prediction_type === 'revenue_plateau')).toBeUndefined();
  });
});
