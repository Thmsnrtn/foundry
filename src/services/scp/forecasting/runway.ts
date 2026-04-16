// =============================================================================
// FOUNDRY — Monte Carlo Runway Simulation & Scenario Modeling
// Answers: "What's going to happen to our runway?"
// =============================================================================

import { query } from '../../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface RunwayScenario {
  name: string;
  assumptions: {
    current_mrr_cents: number;
    current_burn_cents: number; // monthly
    cash_balance_cents: number;
    mrr_growth_rate: number; // monthly, e.g. 0.05 = 5%
    churn_rate: number; // monthly, e.g. 0.02 = 2%
    burn_delta_cents?: number; // additional monthly burn (e.g. new hire)
    one_time_costs_cents?: number; // e.g. legal fees
  };
}

export interface RunwayResult {
  scenario_name: string;
  runway_months: number; // median
  runway_months_p10: number; // pessimistic (10th percentile)
  runway_months_p90: number; // optimistic (90th percentile)
  breakeven_months: number | null; // when MRR covers burn, null if never
  probability_18_months: number; // 0-1, probability of surviving 18 months
  monthly_projection: Array<{
    month: number;
    mrr_cents_median: number;
    cash_cents_median: number;
    is_breakeven: boolean;
  }>;
}

// ─── Core Monte Carlo helpers ─────────────────────────────────────────────────

function simulateOnce(
  assumptions: RunwayScenario['assumptions'],
  growthVariance: number,
  churnVariance: number
): { months: number; breakeven: number | null } {
  const effectiveGrowth = assumptions.mrr_growth_rate * (1 + growthVariance);
  const effectiveChurn = assumptions.churn_rate * (1 + churnVariance);
  let mrr = assumptions.current_mrr_cents;
  let cash = assumptions.cash_balance_cents - (assumptions.one_time_costs_cents ?? 0);
  const monthlyBurn = assumptions.current_burn_cents + (assumptions.burn_delta_cents ?? 0);
  let breakeven: number | null = null;

  for (let month = 1; month <= 36; month++) {
    mrr = mrr * (1 + effectiveGrowth) * (1 - effectiveChurn);
    const netBurn = monthlyBurn - mrr;
    cash -= netBurn;
    if (breakeven === null && netBurn <= 0) breakeven = month;
    if (cash <= 0) return { months: month - 1, breakeven };
  }
  return { months: 36, breakeven };
}

// ─── Public: Run Monte Carlo simulation ──────────────────────────────────────

export async function runMonteCarloSimulation(
  scenario: RunwayScenario,
  iterations = 1000
): Promise<RunwayResult> {
  const runwayResults: number[] = [];
  const breakevenResults: (number | null)[] = [];

  for (let i = 0; i < iterations; i++) {
    const growthVariance = Math.random() * 0.6 - 0.3;
    const churnVariance = Math.random() * 0.4 - 0.2;
    const result = simulateOnce(scenario.assumptions, growthVariance, churnVariance);
    runwayResults.push(result.months);
    breakevenResults.push(result.breakeven);
  }

  // Sort for percentile computation
  runwayResults.sort((a, b) => a - b);

  const p10Index = Math.floor(iterations * 0.1);
  const p50Index = Math.floor(iterations * 0.5);
  const p90Index = Math.floor(iterations * 0.9);

  const runwayP10 = runwayResults[p10Index] ?? 0;
  const runwayMedian = runwayResults[p50Index] ?? 0;
  const runwayP90 = runwayResults[p90Index] ?? 36;

  const survivedCount = runwayResults.filter((m) => m >= 18).length;
  const probability18Months = survivedCount / iterations;

  // Median breakeven: take the median of non-null values
  const validBreakevens = breakevenResults.filter((b): b is number => b !== null);
  validBreakevens.sort((a, b) => a - b);
  const medianBreakeven = validBreakevens.length > 0
    ? (validBreakevens[Math.floor(validBreakevens.length / 2)] ?? null)
    : null;

  // Build deterministic monthly projection using median assumptions
  const monthly_projection: RunwayResult['monthly_projection'] = [];
  let projMrr = scenario.assumptions.current_mrr_cents;
  let projCash = scenario.assumptions.cash_balance_cents - (scenario.assumptions.one_time_costs_cents ?? 0);
  const projBurn = scenario.assumptions.current_burn_cents + (scenario.assumptions.burn_delta_cents ?? 0);
  let projBreakevenHit = false;

  for (let month = 1; month <= 24; month++) {
    projMrr = projMrr * (1 + scenario.assumptions.mrr_growth_rate) * (1 - scenario.assumptions.churn_rate);
    const netBurn = projBurn - projMrr;
    projCash -= netBurn;
    if (!projBreakevenHit && netBurn <= 0) projBreakevenHit = true;

    monthly_projection.push({
      month,
      mrr_cents_median: Math.max(0, Math.round(projMrr)),
      cash_cents_median: Math.max(0, Math.round(projCash)),
      is_breakeven: !projBreakevenHit && netBurn <= 0,
    });

    if (projCash <= 0) break;
  }

  return {
    scenario_name: scenario.name,
    runway_months: runwayMedian,
    runway_months_p10: runwayP10,
    runway_months_p90: runwayP90,
    breakeven_months: medianBreakeven,
    probability_18_months: probability18Months,
    monthly_projection,
  };
}

// ─── Public: Generate 5 scenarios for a product ──────────────────────────────

export async function generateScenariosForProduct(productId: string): Promise<{
  base_case: RunwayResult;
  bear_case: RunwayResult;
  bull_case: RunwayResult;
  hire_2_engineers: RunwayResult;
  raise_prices_20pct: RunwayResult;
}> {
  // 1. Load latest metric snapshot
  const metricsResult = await query(
    `SELECT new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents,
            churned_mrr_cents, churn_rate, snapshot_date
     FROM metric_snapshots
     WHERE product_id = ?
     ORDER BY snapshot_date DESC
     LIMIT 8`,
    [productId]
  );

  const rows = metricsResult.rows as Array<Record<string, unknown>>;
  const latest = rows[0] ?? {};

  // Derive current MRR as cumulative sum of net MRR movements
  // If not available, fall back to a reasonable default
  const newMrr = (latest.new_mrr_cents as number) ?? 0;
  const expansionMrr = (latest.expansion_mrr_cents as number) ?? 0;
  const contractionMrr = (latest.contraction_mrr_cents as number) ?? 0;
  const churnedMrr = (latest.churned_mrr_cents as number) ?? 0;

  // Compute net MRR: new + expansion - contraction - churned
  // Use a running total from all available snapshots as a proxy for current MRR
  let cumulativeMrr = 0;
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    cumulativeMrr += ((r.new_mrr_cents as number) ?? 0)
      + ((r.expansion_mrr_cents as number) ?? 0)
      - ((r.contraction_mrr_cents as number) ?? 0)
      - ((r.churned_mrr_cents as number) ?? 0);
  }
  const currentMrrCents = Math.max(0, cumulativeMrr);

  const rawChurnRate = (latest.churn_rate as number) ?? 0.03;
  // Derive monthly churn from metric snapshot (assumed monthly already)
  const monthlyChurnRate = rawChurnRate > 0 ? rawChurnRate : 0.03;

  // Derive MRR growth rate from last 2 snapshots
  let mrrGrowthRate = 0.05; // default 5% MoM
  if (rows.length >= 2) {
    const prevRow = rows[1] as Record<string, unknown>;
    const prevNet = ((prevRow.new_mrr_cents as number) ?? 0)
      + ((prevRow.expansion_mrr_cents as number) ?? 0)
      - ((prevRow.contraction_mrr_cents as number) ?? 0)
      - ((prevRow.churned_mrr_cents as number) ?? 0);
    const currNet = newMrr + expansionMrr - contractionMrr - churnedMrr;
    if (prevNet > 0) {
      mrrGrowthRate = Math.max(-0.2, Math.min(0.5, (currNet - prevNet) / prevNet));
    }
  }

  // Load product to get operating budget as proxy for burn
  const productResult = await query(
    'SELECT operating_budget_monthly_usd FROM products WHERE id = ?',
    [productId]
  );
  const productRow = (productResult.rows[0] as Record<string, unknown>) ?? {};
  const monthlyBudgetUsd = (productRow.operating_budget_monthly_usd as number) ?? 15000;
  const monthlyBurnCents = monthlyBudgetUsd * 100;

  // Assume cash balance is 12x current burn as a reasonable default
  // (founders can update via financial integrations)
  const cashBalanceCents = monthlyBurnCents * 12;

  // ─ Build 5 scenario assumptions ─────────────────────────────────────────────

  const baseAssumptions: RunwayScenario['assumptions'] = {
    current_mrr_cents: currentMrrCents,
    current_burn_cents: monthlyBurnCents,
    cash_balance_cents: cashBalanceCents,
    mrr_growth_rate: mrrGrowthRate,
    churn_rate: monthlyChurnRate,
  };

  const scenarios: RunwayScenario[] = [
    {
      name: 'Base Case',
      assumptions: { ...baseAssumptions },
    },
    {
      name: 'Bear Case',
      assumptions: {
        ...baseAssumptions,
        mrr_growth_rate: mrrGrowthRate * 0.4, // 60% lower growth
        churn_rate: monthlyChurnRate * 1.5,   // 50% higher churn
      },
    },
    {
      name: 'Bull Case',
      assumptions: {
        ...baseAssumptions,
        mrr_growth_rate: mrrGrowthRate * 2.0, // 2x growth
        churn_rate: monthlyChurnRate * 0.7,   // 30% lower churn
      },
    },
    {
      name: '+2 Engineers',
      assumptions: {
        ...baseAssumptions,
        burn_delta_cents: 30_000_00, // +$30k/mo for 2 engineers
      },
    },
    {
      name: '+20% Prices',
      assumptions: {
        ...baseAssumptions,
        current_mrr_cents: Math.round(currentMrrCents * 1.2), // 20% higher MRR (existing customers at new price)
        churn_rate: monthlyChurnRate * 1.1, // slightly higher churn from price increase
      },
    },
  ];

  // 2. Run Monte Carlo for each scenario
  const [baseResult, bearResult, bullResult, hireResult, priceResult] = await Promise.all(
    scenarios.map((s) => runMonteCarloSimulation(s, 1000))
  );

  // 3. Persist results to forecast_scenarios
  const scenarioTypes = ['runway', 'runway', 'runway', 'hiring', 'pricing'] as const;
  const resultsArr = [baseResult, bearResult, bullResult, hireResult, priceResult];
  const scenariosData = scenarios.map((s, i) => ({
    scenario: s,
    result: resultsArr[i]!,
    type: scenarioTypes[i]!,
  }));

  // Deactivate old scenarios
  await query(
    `UPDATE forecast_scenarios SET is_active = 0 WHERE product_id = ?`,
    [productId]
  );

  for (const { scenario, result, type } of scenariosData) {
    const id = nanoid();
    await query(
      `INSERT INTO forecast_scenarios (id, product_id, name, scenario_type, assumptions_json, results_json, generated_by, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        productId,
        scenario.name,
        type,
        JSON.stringify(scenario.assumptions),
        JSON.stringify({
          runway_months: result.runway_months,
          runway_months_p10: result.runway_months_p10,
          runway_months_p90: result.runway_months_p90,
          breakeven_months: result.breakeven_months,
          probability_18_months: result.probability_18_months,
          monthly_projection: result.monthly_projection,
        }),
      ]
    );

    // Record a checkpoint for today's predicted runway
    const today = new Date().toISOString().slice(0, 10);
    await query(
      `INSERT OR IGNORE INTO forecast_checkpoints (id, product_id, scenario_id, checkpoint_date, predicted_value, metric_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, id, today, result.runway_months, 'runway_months']
    );
  }

  return {
    base_case: baseResult,
    bear_case: bearResult,
    bull_case: bullResult,
    hire_2_engineers: hireResult,
    raise_prices_20pct: priceResult,
  };
}

// ─── Public: Get latest active scenarios ─────────────────────────────────────

export async function getLatestScenarios(productId: string): Promise<Array<{
  id: string;
  name: string;
  scenario_type: string;
  runway_months: number;
  runway_months_p10: number;
  runway_months_p90: number;
  breakeven_months: number | null;
  probability_18_months: number;
  monthly_projection: RunwayResult['monthly_projection'];
  assumptions: Record<string, unknown>;
  created_at: string;
}>> {
  const result = await query(
    `SELECT id, name, scenario_type, assumptions_json, results_json, created_at
     FROM forecast_scenarios
     WHERE product_id = ? AND is_active = 1
     ORDER BY created_at DESC`,
    [productId]
  );

  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    let assumptions: Record<string, unknown> = {};
    let results: Record<string, unknown> = {};
    try { assumptions = JSON.parse(row.assumptions_json as string); } catch { /* ignore */ }
    try { results = JSON.parse(row.results_json as string); } catch { /* ignore */ }

    return {
      id: row.id as string,
      name: row.name as string,
      scenario_type: row.scenario_type as string,
      runway_months: (results.runway_months as number) ?? 0,
      runway_months_p10: (results.runway_months_p10 as number) ?? 0,
      runway_months_p90: (results.runway_months_p90 as number) ?? 0,
      breakeven_months: (results.breakeven_months as number | null) ?? null,
      probability_18_months: (results.probability_18_months as number) ?? 0,
      monthly_projection: (results.monthly_projection as RunwayResult['monthly_projection']) ?? [],
      assumptions,
      created_at: row.created_at as string,
    };
  });
}

// ─── Public: Record actual value for a checkpoint ────────────────────────────

export async function recordCheckpointActual(
  productId: string,
  metricName: string,
  actualValue: number
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Find checkpoint for today
  const checkpointResult = await query(
    `SELECT id, predicted_value FROM forecast_checkpoints
     WHERE product_id = ? AND metric_name = ? AND checkpoint_date = ?
     LIMIT 1`,
    [productId, metricName, today]
  );

  if (checkpointResult.rows.length === 0) return;

  const row = checkpointResult.rows[0] as Record<string, unknown>;
  const checkpointId = row.id as string;
  const predictedValue = row.predicted_value as number;
  const variancePct = predictedValue !== 0
    ? ((actualValue - predictedValue) / Math.abs(predictedValue)) * 100
    : 0;

  await query(
    `UPDATE forecast_checkpoints
     SET actual_value = ?, variance_pct = ?
     WHERE id = ?`,
    [actualValue, variancePct, checkpointId]
  );
}
