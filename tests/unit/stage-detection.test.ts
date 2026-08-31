process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

// =============================================================================
// Tests: Growth Stage Detection
//
// THE STAGE WAS DECIDED BY THE MOVEMENT, NOT THE LEVEL. `detectGrowthStage`
// added the four MRR MOVEMENT columns — new + expansion − contraction −
// churned — and called the result the company's MRR. That is the change over
// the latest period, so a company at $60,000/month with a flat month was
// classified from about $0: `pre_launch` or `early_traction`, which suppresses
// the MRR and churn stressors, relaxes every remaining threshold by 1.5–2×,
// and tells the digest to say "no MRR analysis until you have customers".
//
// The "mature" test had two more: `rows.length >= 12` was called twelve months
// of history, and `metric_snapshots` is keyed by DATE with most companies
// reporting daily, so a fortnight satisfied it; and the rates it compared were
// month-over-month growth of one period's ACQUISITION, not of revenue.
// =============================================================================

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getStageConfig, getStageStressorThresholds, detectGrowthStage,
} from '../../src/services/lifecycle/stage-detection.js';

const P = 'p_stage';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_stage','c_stage','stage@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_stage','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

async function snapshot(date: string, cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date${keys.map((k) => `, ${k}`).join('')})
     VALUES (?, ?, ?${keys.map(() => ', ?').join('')})`,
    [`ms_${date}`, P, date, ...keys.map((k) => cols[k])],
  );
}

describe('the stage a company is put in', () => {
  it('is read from its MRR level, not from one month of movement', async () => {
    // $60,000/month, flat: nothing new, nothing churned.
    await snapshot('2026-06-01', {
      mrr_cents: 6_000_000, new_mrr_cents: 0, expansion_mrr_cents: 0,
      contraction_mrr_cents: 0, churned_mrr_cents: 0,
    });
    expect(await detectGrowthStage(P)).toBe('scale');
  });

  it('does not call a growing company pre-launch because the level is missing', async () => {
    // A company reporting movement but never a level: unknown MRR, and 20
    // active users. The customer count is what we have.
    await snapshot('2026-06-01', { active_users: 20, new_mrr_cents: 100_000 });
    expect(await detectGrowthStage(P)).toBe('early_traction');
  });

  it('is pre_launch when there is nothing to go on', async () => {
    await snapshot('2026-06-01', { active_users: 0 });
    expect(await detectGrowthStage(P)).toBe('pre_launch');
  });

  it('reads the bands from the level', async () => {
    await snapshot('2026-06-01', { mrr_cents: 800_000 });   // $8,000
    expect(await detectGrowthStage(P)).toBe('growth');
  });
});

describe('the mature test', () => {
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  it('is not satisfied by a fortnight of daily snapshots', async () => {
    // Twelve rows, twelve days, $20,000 and flat — which used to read as
    // "twelve months of under-10% growth". $20,000 is the growth band.
    for (let d = 12; d >= 1; d--) {
      await snapshot(daysAgo(d), { mrr_cents: 2_000_000 });
    }
    expect(await detectGrowthStage(P)).toBe('growth');
  });

  it('is satisfied by a flat year', async () => {
    // Twelve points spanning 355 days, all inside the query's own window.
    for (let i = 12; i >= 1; i--) {
      await snapshot(daysAgo(i * 30 - 5), { mrr_cents: 2_000_000 });
    }
    expect(await detectGrowthStage(P)).toBe('mature');
  });

  it('is not satisfied when the year is not flat', async () => {
    let mrr = 2_000_000;
    for (let i = 12; i >= 1; i--) {
      mrr = Math.round(mrr * 1.15);
      await snapshot(daysAgo(i * 30 - 5), { mrr_cents: mrr });
    }
    expect(await detectGrowthStage(P)).not.toBe('mature');
  });
});

describe('getStageConfig', () => {
  it('returns pre_launch config with suppressed metric stressors', () => {
    const config = getStageConfig('pre_launch');
    expect(config.stage).toBe('pre_launch');
    expect(config.suppressedStressors).toContain('mrr_health_ratio');
    expect(config.suppressedStressors).toContain('churn_rate');
    expect(config.stressorThresholdMultiplier).toBe(2.0);
  });

  it('returns early_traction with relaxed thresholds', () => {
    const config = getStageConfig('early_traction');
    expect(config.stressorThresholdMultiplier).toBe(1.5);
    expect(config.digestFocus).toContain('Hypothesis');
  });

  it('returns growth with standard thresholds', () => {
    const config = getStageConfig('growth');
    expect(config.stressorThresholdMultiplier).toBe(1.0);
  });

  it('returns scale with tighter thresholds', () => {
    const config = getStageConfig('scale');
    expect(config.stressorThresholdMultiplier).toBe(0.8);
  });

  it('returns mature with suppressed growth stressors', () => {
    const config = getStageConfig('mature');
    expect(config.suppressedStressors).toContain('slow_growth');
    expect(config.suppressedStressors).toContain('flat_mrr');
  });
});

describe('getStageStressorThresholds', () => {
  it('pre_launch has doubled thresholds', () => {
    const t = getStageStressorThresholds('pre_launch');
    expect(t.mrrHealthRatioCritical).toBe(2.0);
    expect(t.cohortRetentionDeviation).toBe(50);
    expect(t.activationRateDrop).toBe(20);
  });

  it('growth has standard thresholds', () => {
    const t = getStageStressorThresholds('growth');
    expect(t.mrrHealthRatioCritical).toBe(1.0);
    expect(t.mrrHealthRatioElevated).toBe(0.8);
    expect(t.cohortRetentionDeviation).toBe(25);
    expect(t.activationRateDrop).toBe(10);
  });

  it('scale has tighter thresholds', () => {
    const t = getStageStressorThresholds('scale');
    expect(t.mrrHealthRatioCritical).toBe(0.8);
    expect(t.activationRateDrop).toBe(8);
  });
});
