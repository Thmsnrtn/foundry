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
}

export interface ExitScenario {
  exit_valuation: number;
  label: string;
  founder_proceeds: number;
  founder_pct: number;
}

export interface CapTableScenarioRow {
  id: string;
  product_id: string;
  scenario_name: string;
  exit_valuation: number | null;
  stakeholders_json: string;
  founder_proceeds: number | null;
  total_dilution_pct: number | null;
  preference_waterfall_json: string | null;
  created_at: string;
}

// ─── computeWaterfall ────────────────────────────────────────────────────────

export async function computeWaterfall(
  stakeholders: Stakeholder[],
  exitValuation: number
): Promise<WaterfallResult> {
  // Total shares including vested options
  const vestingAdjusted = stakeholders.map((s) => ({
    ...s,
    effectiveShares: s.shares + Math.round(s.options * (s.vested_pct / 100)),
  }));

  const totalShares = vestingAdjusted.reduce((sum, s) => sum + s.effectiveShares, 0);

  if (totalShares === 0) {
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
    };
  }

  // Separate investors (with liquidation preferences) from common holders
  const investors = vestingAdjusted.filter(
    (s) => s.type === 'investor' && s.invested > 0
  );
  const commonHolders = vestingAdjusted.filter(
    (s) => s.type !== 'investor' || s.invested === 0
  );

  // Step 1: Pay liquidation preferences to investors
  let remaining = exitValuation;
  let prefConsumed = 0;

  const proceeds: Record<string, number> = {};

  // Sort investors by preference priority (higher multiple = higher priority, simplified)
  const sortedInvestors = [...investors].sort(
    (a, b) => b.preference_multiple - a.preference_multiple
  );

  for (const inv of sortedInvestors) {
    const prefAmount = inv.invested * inv.preference_multiple;
    const paid = Math.min(prefAmount, remaining);
    proceeds[inv.name] = (proceeds[inv.name] ?? 0) + paid;
    remaining -= paid;
    prefConsumed += paid;
  }

  // Step 2: Distribute remainder pro-rata (participating preferred also participates)
  if (remaining > 0) {
    // Participating investors join common holders in the pro-rata pool
    const participatingInvestors = investors.filter((s) => s.is_participating);
    const proRataPool = [...commonHolders, ...participatingInvestors];
    const proRataShares = proRataPool.reduce((sum, s) => sum + s.effectiveShares, 0);

    if (proRataShares > 0) {
      for (const s of proRataPool) {
        const share = (s.effectiveShares / proRataShares) * remaining;
        proceeds[s.name] = (proceeds[s.name] ?? 0) + share;
      }
    }
  }

  // Build result
  const proceedsList = vestingAdjusted.map((s) => {
    const gross_proceeds = proceeds[s.name] ?? 0;
    return {
      name: s.name,
      type: s.type,
      gross_proceeds: Math.round(gross_proceeds),
      net_pct: parseFloat(((gross_proceeds / exitValuation) * 100).toFixed(2)),
    };
  });

  const founderTotal = proceedsList
    .filter((p) => {
      const s = vestingAdjusted.find((st) => st.name === p.name);
      return s?.type === 'founder';
    })
    .reduce((sum, p) => sum + p.gross_proceeds, 0);

  const investorTotal = proceedsList
    .filter((p) => {
      const s = vestingAdjusted.find((st) => st.name === p.name);
      return s?.type === 'investor';
    })
    .reduce((sum, p) => sum + p.gross_proceeds, 0);

  const employeeTotal = proceedsList
    .filter((p) => {
      const s = vestingAdjusted.find((st) => st.name === p.name);
      return s?.type === 'employee' || s?.type === 'advisor';
    })
    .reduce((sum, p) => sum + p.gross_proceeds, 0);

  return {
    proceeds_by_stakeholder: proceedsList,
    founder_total: Math.round(founderTotal),
    investor_total: Math.round(investorTotal),
    employee_total: Math.round(employeeTotal),
    liquidation_preferences_consumed: Math.round(prefConsumed),
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
  let totalDilutionPct: number | null = null;
  let preferencewaterfallJson: string | null = null;

  if (scenario.exit_valuation && scenario.exit_valuation > 0) {
    const waterfall = await computeWaterfall(scenario.stakeholders, scenario.exit_valuation);
    founderProceeds = waterfall.founder_total;
    totalDilutionPct = parseFloat(
      ((waterfall.investor_total / scenario.exit_valuation) * 100).toFixed(2)
    );
    preferencewaterfallJson = JSON.stringify(waterfall.proceeds_by_stakeholder);
  }

  await query(
    `INSERT INTO cap_table_scenarios
       (id, product_id, scenario_name, exit_valuation, stakeholders_json,
        founder_proceeds, total_dilution_pct, preference_waterfall_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      scenario.scenario_name,
      scenario.exit_valuation ?? null,
      JSON.stringify(scenario.stakeholders),
      founderProceeds,
      totalDilutionPct,
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
      total_dilution_pct: row.total_dilution_pct as number | null,
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
    });
  }

  return results;
}
