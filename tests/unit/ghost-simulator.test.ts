// =============================================================================
// Tests: Ghost Company simulator (Ascent B3)
//
// The honesty contract, verified: abstains without history; all numbers derive
// from the company's own snapshots + a seeded RNG (same decision → identical
// fork, twice); percentiles are ordered; the do-nothing ghost is always
// included; results persist to scenario_models (the chamber's existing stage).
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../../src/services/ai/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: vi.fn(async () => ({
      content: JSON.stringify({
        options: [
          { label: 'Raise price', growth_delta_pp: 1.5, rationale: 'Higher ARPU, mild churn risk' },
          { label: 'Hold price', growth_delta_pp: 0, rationale: 'No change' },
        ],
      }),
      model: 'sonnet',
      usage: { input_tokens: 300, output_tokens: 150 },
    })),
  };
});

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { estimateBaseline, runGhostFork } from '../../src/services/ghost/simulator.js';

async function seedHistory(productId: string, mrrs: number[]): Promise<void> {
  for (let i = 0; i < mrrs.length; i++) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES (?, ?, ?, ?)`,
      [`gs_${productId}_${i}`, productId, `2026-0${(i % 9) + 1}-01`, mrrs[i]],
    );
  }
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('p_gh','GhostCo','o1')", []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('p_thin','ThinCo','o1')", []);
  // Steady grower: 100 → 105 → 110 → 116 → 122 ($/mo, in cents)
  await seedHistory('p_gh', [10000, 10500, 11000, 11600, 12200]);
  await seedHistory('p_thin', [10000, 10500]); // too thin
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, options, status)
     VALUES ('dec_gh', 'p_gh', 'strategic', 3, 'Raise price to $99', 'Margin', ?, 'pending')`,
    [JSON.stringify([{ label: 'Raise price' }, { label: 'Hold price' }])],
  );
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES ('dec_thin', 'p_thin', 'strategic', 3, 'Bet', 'Now', 'pending')`,
    [],
  );
});

// =============================================================================
// A GROWTH RATE HAS A PERIOD, AND THIS ONE'S WAS THE REPORTING CADENCE.
//
// The rate between two consecutive snapshots was called `monthlyGrowthMean` and
// compounded three times for a 90-day horizon. `metric_snapshots` is keyed by
// DATE and companies report daily, so for most of them that was the mean DAILY
// growth compounded over three days, presented as a 90-day forecast with
// p10/p50/p90 bands — over MCP, to an agent making a gate-3 decision.
//
// And the window took the OLDEST 24 snapshots (`ORDER BY snapshot_date ASC
// LIMIT 24`), so a company with two years of history was simulated forward from
// the growth rate of its first three weeks.
// =============================================================================

async function seedDated(productId: string, rows: Array<[string, number]>): Promise<void> {
  for (const [date, mrr] of rows) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES (?, ?, ?, ?)`,
      [`sd_${productId}_${date}`, productId, date, mrr],
    );
  }
}

describe('the period of the growth rate', () => {
  it('reads a daily reporter as daily, not monthly', async () => {
    await query("INSERT INTO products (id, name, owner_id) VALUES ('p_daily','DailyCo','o1')", []);
    // 1% a day for four days.
    await seedDated('p_daily', [
      ['2026-03-01', 10000], ['2026-03-02', 10100],
      ['2026-03-03', 10201], ['2026-03-04', 10303],
    ]);

    const b = await estimateBaseline('p_daily');
    expect(b).toBeTruthy();
    // 1%/day compounds to about 35%/month — the old code called it 1%/month.
    expect(b!.monthlyGrowthMean).toBeGreaterThan(0.3);
    expect(b!.monthlyGrowthMean).toBeLessThan(0.4);
    expect(b!.historySpanDays).toBe(3);
  });

  it('reads a monthly reporter as monthly', async () => {
    await query("INSERT INTO products (id, name, owner_id) VALUES ('p_monthly','MonthlyCo','o1')", []);
    await seedDated('p_monthly', [
      ['2026-01-01', 10000], ['2026-02-01', 10500],
      ['2026-03-01', 11025], ['2026-04-01', 11576],
    ]);
    const b = await estimateBaseline('p_monthly');
    expect(b!.monthlyGrowthMean).toBeGreaterThan(0.045);
    expect(b!.monthlyGrowthMean).toBeLessThan(0.055);
    expect(b!.historySpanDays).toBe(90);
  });

  it('uses the most recent snapshots, not the first ones', async () => {
    await query("INSERT INTO products (id, name, owner_id) VALUES ('p_long','LongCo','o1')", []);
    // Two flat years, then two years of 20%-a-month growth. The window is 24
    // snapshots, so it should cover the growth and none of the flat stretch.
    const rows: Array<[string, number]> = [];
    for (let i = 0; i < 24; i++) {
      rows.push([`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, 10000]);
    }
    let mrr = 10000;
    for (let i = 0; i < 24; i++) {
      mrr = Math.round(mrr * 1.2);
      rows.push([`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, mrr]);
    }
    await seedDated('p_long', rows);

    const b = await estimateBaseline('p_long');
    expect(b!.nSnapshots).toBe(24);
    // Reading the FIRST 24 gave a flat 0% for a company growing 20% a month.
    expect(b!.monthlyGrowthMean).toBeGreaterThan(0.15);
    expect(b!.monthlyGrowthMean).toBeLessThan(0.25);
  });
});

describe('Ghost Company simulator', () => {
  it('estimates the baseline from the company\'s own history', async () => {
    const b = await estimateBaseline('p_gh');
    expect(b).toBeTruthy();
    expect(b!.currentMrrCents).toBe(12200);
    expect(b!.monthlyGrowthMean).toBeGreaterThan(0.03);
    expect(b!.monthlyGrowthMean).toBeLessThan(0.07);
  });

  it('abstains (Honesty Law) when history is too thin', async () => {
    expect(await estimateBaseline('p_thin')).toBeNull();
    expect(await runGhostFork('dec_thin', 'p_thin')).toBeNull();
    const r = await query("SELECT COUNT(*) AS n FROM scenario_models WHERE decision_id='dec_thin'", []);
    expect(Number((r.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('forks reality: ghost + one fork per option, ordered percentiles, persisted', async () => {
    const forks = await runGhostFork('dec_gh', 'p_gh');
    expect(forks).toBeTruthy();
    expect(forks!.length).toBe(3); // ghost + 2 options
    expect(forks![0].label).toBe('Ghost (do nothing)');
    for (const f of forks!) {
      expect(f.p10).toBeLessThanOrEqual(f.p50);
      expect(f.p50).toBeLessThanOrEqual(f.p90);
      expect(f.probDecline).toBeGreaterThanOrEqual(0);
      expect(f.probDecline).toBeLessThanOrEqual(1);
    }
    // The +1.5pp option should out-median the 0pp option (same seed family, big N).
    const raise = forks!.find((f) => f.label === 'Raise price')!;
    const hold = forks!.find((f) => f.label === 'Hold price')!;
    expect(raise.p50).toBeGreaterThan(hold.p50 * 0.98); // dominance within noise

    const rows = await query("SELECT option_label, base_case, data_inputs_used FROM scenario_models WHERE decision_id='dec_gh'", []);
    expect(rows.rows.length).toBe(3);
    const assumptions = JSON.parse((rows.rows[0] as Record<string, string>).data_inputs_used);
    expect(assumptions.runs).toBe(1000);
    expect(assumptions.n_snapshots).toBe(5); // ledger: assumptions recorded
  });

  it('is idempotent — a second fork does not duplicate scenarios', async () => {
    expect(await runGhostFork('dec_gh', 'p_gh')).toBeNull();
    const r = await query("SELECT COUNT(*) AS n FROM scenario_models WHERE decision_id='dec_gh'", []);
    expect(Number((r.rows[0] as Record<string, unknown>).n)).toBe(3);
  });

  it('is deterministic — same seed reproduces the same numbers', async () => {
    // Re-run the pure pipeline on a fresh decision with identical inputs.
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, options, status)
       VALUES ('dec_gh2', 'p_gh', 'strategic', 3, 'Raise price to $99', 'Margin', ?, 'pending')`,
      [JSON.stringify([{ label: 'Raise price' }, { label: 'Hold price' }])],
    );
    const a = await runGhostFork('dec_gh2', 'p_gh');
    // Delete + re-run with the same decision id → identical percentiles.
    await query("DELETE FROM scenario_models WHERE decision_id='dec_gh2'", []);
    const b = await runGhostFork('dec_gh2', 'p_gh');
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect(b!.map((f) => f.p50)).toEqual(a!.map((f) => f.p50));
    expect(b!.map((f) => f.p10)).toEqual(a!.map((f) => f.p10));
  });
});
