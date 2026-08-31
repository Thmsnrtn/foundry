process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  computeWaterfall, runMultipleExitScenarios, saveCapTableScenario,
  getCapTableScenarios, type Stakeholder,
} from '../../src/services/scp/exit/cap-table.js';

// =============================================================================
// A LIQUIDATION PREFERENCE IS A FLOOR, AND THE WATERFALL TREATED IT AS A CEILING.
//
// A non-participating investor takes the GREATER of their preference and their
// shares converted to common. The version this covers paid the preference and
// stopped, so every dollar above it went to the common holders — an error that
// ran in one direction, towards the founder, on the page where a founder
// decides whether to sell.
//
// The numbers below are the cap table printed in the form's own placeholder.
// =============================================================================

const FOUNDER: Stakeholder = {
  name: 'Founder A', type: 'founder', shares: 3_000_000, options: 0,
  invested: 0, preference_multiple: 1, is_participating: false, vested_pct: 100,
};
const SEED: Stakeholder = {
  name: 'Seed VC', type: 'investor', shares: 500_000, options: 0,
  invested: 500_000, preference_multiple: 1, is_participating: false, vested_pct: 100,
};

describe('the example on the form', () => {
  it('converts the investor at a $250M exit instead of handing them $500K', async () => {
    const w = await computeWaterfall([FOUNDER, SEED], 250_000_000);

    // 500,000 of 3,500,000 shares is 14.2857%.
    expect(w.investor_total).toBeCloseTo(35_714_286, -2);
    expect(w.founder_total).toBeCloseTo(214_285_714, -2);
    expect(w.converting_investors).toEqual(['Seed VC']);

    // No preference is consumed, because the investor gave it up to convert.
    expect(w.liquidation_preferences_consumed).toBe(0);

    // What the old code said: $500,000 and $249,500,000.
    expect(w.founder_total).not.toBe(249_500_000);
  });

  it('pays the preference when the preference is worth more', async () => {
    // A $2M exit: 14.2857% of it is $285,714, less than the $500,000 floor.
    const w = await computeWaterfall([FOUNDER, SEED], 2_000_000);
    expect(w.investor_total).toBe(500_000);
    expect(w.converting_investors).toEqual([]);
    expect(w.liquidation_preferences_consumed).toBe(500_000);
    expect(w.founder_total).toBe(1_500_000);
  });

  it('takes the better side either way, across the crossover', async () => {
    // The crossover is where 14.2857% of the exit equals $500,000: $3.5M.
    const below = await computeWaterfall([FOUNDER, SEED], 3_000_000);
    const above = await computeWaterfall([FOUNDER, SEED], 4_000_000);
    expect(below.investor_total).toBe(500_000);        // the floor
    expect(above.investor_total).toBeCloseTo(571_429, -1); // the shares
    // The investor never does worse than their preference.
    for (const w of [below, above]) expect(w.investor_total).toBeGreaterThanOrEqual(500_000);
  });
});

describe('the founder scenario table', () => {
  it('stops claiming the founder keeps ~100% of a large exit', async () => {
    const scenarios = await runMultipleExitScenarios('p_x', [FOUNDER, SEED]);
    const biggest = scenarios[scenarios.length - 1];
    expect(biggest.exit_valuation).toBe(250_000_000);
    expect(biggest.founder_pct).toBeCloseTo(85.7, 1);
    expect(biggest.founder_pct).toBeLessThan(99);
    expect(biggest.converting_investors).toEqual(['Seed VC']);

    // Every exit point this page models is above the crossover ($3.5M), so the
    // investor converts at all six and the founder's share is FLAT at their
    // ownership. Under the old code it climbed towards 100% as the exit grew —
    // the bigger the exit, the bigger the overstatement.
    for (const s of scenarios) {
      expect(s.founder_pct).toBeCloseTo(85.7, 1);
      expect(s.converting_investors).toEqual(['Seed VC']);
    }
  });
});

describe('participating preferred', () => {
  it('takes the preference and participates, and is never listed as converting', async () => {
    const participating: Stakeholder = { ...SEED, is_participating: true };
    const w = await computeWaterfall([FOUNDER, participating], 10_000_000);
    // $500,000 preference, then 14.2857% of the remaining $9.5M.
    expect(w.investor_total).toBeCloseTo(500_000 + 1_357_143, -2);
    expect(w.converting_investors).toEqual([]);
    expect(w.liquidation_preferences_consumed).toBe(500_000);
  });
});

describe('two stakeholders with the same name', () => {
  it('are two people, and each is paid their own shares', async () => {
    // Proceeds used to accumulate into a record keyed by name, and the lookup
    // that sorted them into founder/investor/employee totals matched on name
    // too. Two employees called Alex shared one entry.
    const alexOne: Stakeholder = {
      name: 'Alex', type: 'employee', shares: 100_000, options: 0,
      invested: 0, preference_multiple: 1, is_participating: false, vested_pct: 100,
    };
    const alexTwo: Stakeholder = { ...alexOne, shares: 300_000 };
    const w = await computeWaterfall([FOUNDER, alexOne, alexTwo], 10_000_000);

    const rows = w.proceeds_by_stakeholder.filter((p) => p.name === 'Alex');
    expect(rows).toHaveLength(2);
    // 100k and 300k of 3,400,000 shares.
    expect(rows[0].gross_proceeds).toBeCloseTo(294_118, -2);
    expect(rows[1].gross_proceeds).toBeCloseTo(882_353, -2);
    expect(w.employee_total).toBeCloseTo(1_176_471, -2);
    expect(rows[0].gross_proceeds).not.toBe(rows[1].gross_proceeds);
  });
});

describe('an exit with nothing to divide', () => {
  it('reports zeros rather than NaN', async () => {
    const w = await computeWaterfall([FOUNDER, SEED], 0);
    expect(w.founder_total).toBe(0);
    expect(w.investor_total).toBe(0);
    for (const p of w.proceeds_by_stakeholder) {
      expect(Number.isFinite(p.net_pct)).toBe(true);
      expect(p.net_pct).toBe(0);
    }
  });
});

describe('two investors whose choices interact', () => {
  it('settles both, and neither ends below their preference', async () => {
    // A senior 2x and a junior 1x. Whether the junior converts depends on
    // whether the senior took its preference out of the pot first.
    const senior: Stakeholder = {
      name: 'Growth Fund', type: 'investor', shares: 1_000_000, options: 0,
      invested: 4_000_000, preference_multiple: 2, is_participating: false, vested_pct: 100,
    };
    const junior: Stakeholder = {
      name: 'Seed VC', type: 'investor', shares: 500_000, options: 0,
      invested: 500_000, preference_multiple: 1, is_participating: false, vested_pct: 100,
    };
    const w = await computeWaterfall([FOUNDER, senior, junior], 20_000_000);

    const by = Object.fromEntries(w.proceeds_by_stakeholder.map((p) => [p.name, p.gross_proceeds]));
    expect(by['Growth Fund']).toBeGreaterThanOrEqual(8_000_000);  // 2x floor
    expect(by['Seed VC']).toBeGreaterThanOrEqual(500_000);        // 1x floor
    // Nobody is paid twice: the totals add up to the exit.
    const sum = w.proceeds_by_stakeholder.reduce((t, p) => t + p.gross_proceeds, 0);
    expect(sum).toBeCloseTo(20_000_000, -2);
  });
});

// =============================================================================
// AND THE SAVED ROW THAT HELD NOTHING BUT NAMES.
//
// `saveCapTableScenario` fills `founder_proceeds` and `investor_proceeds_pct`
// only when given an exit valuation to model against, and its one caller never
// passed one — so both columns were NULL in every row ever written while the
// Saved Scenarios table advertised them as columns.
//
// The column was also called `total_dilution_pct` and rendered under a heading
// reading "Dilution". It holds the investors' share of the PROCEEDS, which is a
// different number from ownership dilution whenever a preference bites — the
// entire subject of this page. Migration 208 renames it.
// =============================================================================

describe('the saved scenario', () => {
  it('carries the proceeds when given a valuation to model against', async () => {
    await runMigrations();
    await query("INSERT OR IGNORE INTO founders (id, clerk_user_id, email) VALUES ('f_ct','c_ct','ct@example.com')");
    await query("INSERT OR IGNORE INTO products (id, name, owner_id, status) VALUES ('p_ct','Acme','f_ct','active')");

    await saveCapTableScenario('p_ct', {
      scenario_name: 'With a valuation',
      stakeholders: [FOUNDER, SEED],
      exit_valuation: 250_000_000,
    });
    await saveCapTableScenario('p_ct', {
      scenario_name: 'Without one',
      stakeholders: [FOUNDER, SEED],
    });

    const rows = await getCapTableScenarios('p_ct');
    const withVal = rows.find((r) => r.scenario_name === 'With a valuation')!;
    const without = rows.find((r) => r.scenario_name === 'Without one')!;

    expect(withVal.founder_proceeds).toBeCloseTo(214_285_714, -2);
    // 14.29% of the proceeds — the investor converted, so proceeds share and
    // ownership coincide here. They do not at $2M, which is the next case.
    expect(withVal.investor_proceeds_pct).toBeCloseTo(14.29, 1);

    // Absent, and absent is what it says: the row holds the stakeholders only.
    expect(without.founder_proceeds).toBeNull();
    expect(without.investor_proceeds_pct).toBeNull();
    expect(without.exit_valuation).toBeNull();
  });

  it('stores the proceeds share, which is not dilution', async () => {
    // At a $2M exit the investor takes their $500,000 preference: 25% of the
    // proceeds, on 14.29% of the company. A column headed "Dilution" showing
    // 25 would have told the founder they gave away a quarter of it.
    await saveCapTableScenario('p_ct', {
      scenario_name: 'Preference bites',
      stakeholders: [FOUNDER, SEED],
      exit_valuation: 2_000_000,
    });
    const row = (await getCapTableScenarios('p_ct'))
      .find((r) => r.scenario_name === 'Preference bites')!;
    expect(row.investor_proceeds_pct).toBeCloseTo(25, 1);
    // The investor's ownership, for contrast: 500,000 of 3,500,000 shares.
    expect(row.investor_proceeds_pct).not.toBeCloseTo(14.29, 1);
  });
});
