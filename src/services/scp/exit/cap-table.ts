// =============================================================================
// FOUNDRY — Cap Table Scenario Modeling
// Liquidation preference waterfall calculator and exit scenario runner.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Stakeholder {
  name: string;
  type: 'founder' | 'investor' | 'employee' | 'advisor';
  shares: number;
  options: number; // unexercised options
  invested: number; // total invested amount (for liquidation preference calc)
  preference_multiple: number; // 1x, 2x, etc.
  is_participating: boolean;
  vested_pct: number; // 0-100
}

export interface WaterfallResult {
  proceeds_by_stakeholder: Array<{
    name: string;
    type: string;
    gross_proceeds: number;
    net_pct: number;
  }>;
  founder_total: number;
  investor_total: number;
  employee_total: number;
  liquidation_preferences_consumed: number;
  /** Non-participating investors who do better converting to common at this
   *  valuation than taking their preference. Named because it is the single
   *  fact that decides how much of a large exit reaches the founders, and the
   *  founder should be able to see who it applies to. */
  converting_investors: string[];
}

export interface ExitScenario {
  exit_valuation: number;
  label: string;
  founder_proceeds: number;
  founder_pct: number;
  converting_investors: string[];
}

export interface CapTableScenarioRow {
  id: string;
  product_id: string;
  scenario_name: string;
  exit_valuation: number | null;
  stakeholders_json: string;
  founder_proceeds: number | null;
  /** The investors' share of the exit PROCEEDS, which is not dilution: a
   *  preference that bites pays an investor far more than their ownership. The
   *  column was called `total_dilution_pct` and rendered under a column headed
   *  "Dilution" (migration 208). */
  investor_proceeds_pct: number | null;
  preference_waterfall_json: string | null;
  created_at: string;
}

// ─── computeWaterfall ────────────────────────────────────────────────────────
//
// A NON-PARTICIPATING PREFERENCE IS A FLOOR, AND THIS TREATED IT AS A CEILING.
//
// An investor holding 1x non-participating preferred took their money back here
// and then stopped, so every dollar above the preference went to the common
// holders. That is not what the term means. A non-participating investor takes
// the GREATER of the preference and what their shares are worth converted to
// common — the choice between the two is the entire reason the term is
// negotiated — and the version this replaces never gave them the second option.
//
// The error ran in one direction, towards the founder, on the page where a
// founder decides whether to sell. The placeholder cap table printed on the
// form is a worked example of it: a founder with 3,000,000 shares and a seed
// investor with 500,000 shares who put in $500,000 on 1x non-participating. At
// the $250M exit this page models, the old code paid the investor their
// $500,000 and told the founder they would take $249.50M — 99.8% of the exit.
// The investor owns 14.29% of the company and would obviously convert: $35.71M
// to them, $214.29M to the founder. The page overstated the founder's proceeds
// by thirty-five million dollars, in its own example.
//
// WHOSE CONVERSION DEPENDS ON WHOSE. An investor who converts gives up their
// preference, which leaves more in the pot and enlarges the common pool — and
// that can flip another investor's decision. The choices are not independent,
// so this runs them to a fixed point: each non-participating investor takes
// whichever side of their own choice pays them more, given everyone else's
// current choice, repeated until nobody wants to move. It is bounded by the
// number of investors plus a margin, and if it has not settled by then it
// stops and reports the last state rather than looping.
//
// WHAT THIS STILL DOES NOT MODEL, said plainly because a founder may carry
// these numbers into a negotiation: participation caps, seniority stacks (this
// pays higher multiples first, which is not the same as last-money-first),
// accrued dividends or interest on preferred, and option-pool refresh at close.

export async function computeWaterfall(
  stakeholders: Stakeholder[],
  exitValuation: number
): Promise<WaterfallResult> {
  // Total shares including vested options
  const holders = stakeholders.map((s) => ({
    ...s,
    effectiveShares: s.shares + Math.round(s.options * (s.vested_pct / 100)),
  }));

  const totalShares = holders.reduce((sum, s) => sum + s.effectiveShares, 0);

  // An exit of zero (or less) has nothing to divide, and it also has no
  // denominator: `net_pct` used to divide by it and hand the page a NaN.
  if (totalShares === 0 || exitValuation <= 0) {
    return {
      proceeds_by_stakeholder: stakeholders.map((s) => ({
        name: s.name,
        type: s.type,
        gross_proceeds: 0,
        net_pct: 0,
      })),
      founder_total: 0,
      investor_total: 0,
      employee_total: 0,
      liquidation_preferences_consumed: 0,
      converting_investors: [],
    };
  }

  // INDEXES, NOT NAMES. Proceeds accumulated into a record keyed by stakeholder
  // name, so two employees both called "Alex" shared one entry, and the lookup
  // that sorted proceeds into founder/investor/employee totals matched on name
  // too — it returned whichever of them appeared first. Positions are unique;
  // names are whatever the founder typed into a JSON textarea.
  const isPreferred = (i: number) => holders[i].type === 'investor' && holders[i].invested > 0;
  const investorIdx = holders.map((_, i) => i).filter(isPreferred);

  // Higher multiple first. A simplification, and named as one above.
  const prefOrder = [...investorIdx].sort(
    (a, b) => holders[b].preference_multiple - holders[a].preference_multiple
  );

  /** One pass of the waterfall, given who has chosen to convert to common. */
  function runOnce(converted: Set<number>): { proceeds: number[]; prefConsumed: number } {
    const proceeds = new Array<number>(holders.length).fill(0);
    let remaining = exitValuation;
    let prefConsumed = 0;

    // Step 1: preferences, to the investors who have not converted.
    for (const i of prefOrder) {
      if (converted.has(i)) continue;
      const paid = Math.min(holders[i].invested * holders[i].preference_multiple, remaining);
      proceeds[i] += paid;
      remaining -= paid;
      prefConsumed += paid;
    }

    // Step 2: the remainder, pro-rata over common, participating preferred, and
    // anyone who converted.
    if (remaining > 0) {
      const pool = holders
        .map((_, i) => i)
        .filter((i) => !isPreferred(i) || converted.has(i) || holders[i].is_participating);
      const poolShares = pool.reduce((sum, i) => sum + holders[i].effectiveShares, 0);
      if (poolShares > 0) {
        for (const i of pool) {
          proceeds[i] += (holders[i].effectiveShares / poolShares) * remaining;
        }
      }
    }

    return { proceeds, prefConsumed };
  }

  // Each non-participating investor takes the better of their two options,
  // given everyone else's current choice, until nobody wants to move.
  const converted = new Set<number>();
  let run = runOnce(converted);
  for (let round = 0; round < investorIdx.length + 2; round++) {
    let changed = false;
    for (const i of investorIdx) {
      if (holders[i].is_participating) continue; // takes both; nothing to choose
      const wasConverted = converted.has(i);
      const trial = new Set(converted);
      if (wasConverted) trial.delete(i); else trial.add(i);
      const alt = runOnce(trial);
      if (alt.proceeds[i] > run.proceeds[i] + 1e-6) {
        if (wasConverted) converted.delete(i); else converted.add(i);
        run = alt;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const proceedsList = holders.map((s, i) => ({
    name: s.name,
    type: s.type,
    gross_proceeds: Math.round(run.proceeds[i]),
    net_pct: parseFloat(((run.proceeds[i] / exitValuation) * 100).toFixed(2)),
  }));

  const totalFor = (types: string[]) => holders.reduce(
    (sum, s, i) => (types.includes(s.type) ? sum + run.proceeds[i] : sum), 0);

  return {
    proceeds_by_stakeholder: proceedsList,
    founder_total: Math.round(totalFor(['founder'])),
    investor_total: Math.round(totalFor(['investor'])),
    employee_total: Math.round(totalFor(['employee', 'advisor'])),
    liquidation_preferences_consumed: Math.round(run.prefConsumed),
    converting_investors: [...converted].sort((a, b) => a - b).map((i) => holders[i].name),
  };
}

// ─── saveCapTableScenario ─────────────────────────────────────────────────────

export async function saveCapTableScenario(
  productId: string,
  scenario: {
    scenario_name: string;
    exit_valuation?: number;
    stakeholders: Stakeholder[];
  }
): Promise<string> {
  const id = nanoid();

  let founderProceeds: number | null = null;
  let investorProceedsPct: number | null = null;
  let preferencewaterfallJson: string | null = null;

  if (scenario.exit_valuation && scenario.exit_valuation > 0) {
    const waterfall = await computeWaterfall(scenario.stakeholders, scenario.exit_valuation);
    founderProceeds = waterfall.founder_total;
    investorProceedsPct = parseFloat(
      ((waterfall.investor_total / scenario.exit_valuation) * 100).toFixed(2)
    );
    preferencewaterfallJson = JSON.stringify(waterfall.proceeds_by_stakeholder);
  }

  await query(
    `INSERT INTO cap_table_scenarios
       (id, product_id, scenario_name, exit_valuation, stakeholders_json,
        founder_proceeds, investor_proceeds_pct, preference_waterfall_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      scenario.scenario_name,
      scenario.exit_valuation ?? null,
      JSON.stringify(scenario.stakeholders),
      founderProceeds,
      investorProceedsPct,
      preferencewaterfallJson,
    ]
  );

  return id;
}

// ─── getCapTableScenarios ─────────────────────────────────────────────────────

export async function getCapTableScenarios(productId: string): Promise<CapTableScenarioRow[]> {
  const res = await query(
    `SELECT * FROM cap_table_scenarios
     WHERE product_id=?
     ORDER BY created_at DESC`,
    [productId]
  );
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      product_id: row.product_id as string,
      scenario_name: row.scenario_name as string,
      exit_valuation: row.exit_valuation as number | null,
      stakeholders_json: row.stakeholders_json as string,
      founder_proceeds: row.founder_proceeds as number | null,
      investor_proceeds_pct: row.investor_proceeds_pct as number | null,
      preference_waterfall_json: row.preference_waterfall_json as string | null,
      created_at: row.created_at as string,
    };
  });
}

// ─── runMultipleExitScenarios ─────────────────────────────────────────────────

export async function runMultipleExitScenarios(
  productId: string,
  stakeholders: Stakeholder[]
): Promise<ExitScenario[]> {
  const exitPoints = [
    { valuation: 5_000_000, label: '$5M exit' },
    { valuation: 10_000_000, label: '$10M exit' },
    { valuation: 25_000_000, label: '$25M exit' },
    { valuation: 50_000_000, label: '$50M exit' },
    { valuation: 100_000_000, label: '$100M exit' },
    { valuation: 250_000_000, label: '$250M exit' },
  ];

  const results: ExitScenario[] = [];

  for (const point of exitPoints) {
    const waterfall = await computeWaterfall(stakeholders, point.valuation);
    results.push({
      exit_valuation: point.valuation,
      label: point.label,
      founder_proceeds: waterfall.founder_total,
      founder_pct: parseFloat(
        ((waterfall.founder_total / point.valuation) * 100).toFixed(1)
      ),
      converting_investors: waterfall.converting_investors,
    });
  }

  return results;
}
