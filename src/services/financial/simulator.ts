// =============================================================================
// FOUNDRY — Financial Scenario Simulator
// What-if modeling, runway projection, break-even analysis.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import { getFinancialPosition } from './position.js';

/**
 * THE SECOND RUNWAY MODEL, AND THE SECOND SET OF INVENTED INPUTS.
 *
 * `scp/forecasting/runway.ts` defined cash as twelve times a burn read from the
 * AI spend cap. This file defined it as six times revenue, under the comment
 * "would be explicit in full implementation", and defined burn as thirty per
 * cent of revenue or five hundred dollars. Two implementations of one rule,
 * both fabricated, disagreeing with each other — a company would have been
 * given two different runways depending on which page it opened.
 *
 * Both now read the position the founder stated (`financial/position.ts`), and
 * both return nothing when there is none. `runway_months: 999` for a profitable
 * company is gone too: profitable-with-no-cash-figure is not infinite runway,
 * it is an unanswered question about how much money is in the bank.
 */
export interface RunwayModel {
  monthly_burn: number;
  monthly_revenue: number;
  cash_on_hand: number;
  /** NULL when the company is net cash-flow positive: the money does not run
   *  out on the current trajectory, which is a different statement from a
   *  number, and `999` was being stored and rendered as one. */
  runway_months: number | null;
  break_even_date: string | null;
  break_even_mrr: number;
  personal_runway_months: number | null;
  /** NULL when there is no break-even date to compare a personal runway with,
   *  or no personal runway stated. It was 0, which reads as "they line up". */
  gap_months: number | null;
}

export interface FinancialScenario {
  id: string;
  scenario_name: string;
  scenario_type: string;
  inputs: Record<string, unknown>;
  projections: MonthlyProjection[];
  assumptions: string[];
  recommendations: string[];
}

interface MonthlyProjection {
  month: number;
  mrr: number;
  customers: number;
  burn: number;
  net_cash_flow: number;
  cumulative_cash: number;
  runway_remaining: number;
}

/**
 * Compute the current runway model for a founder/product.
 */
export async function computeRunwayModel(
  founderId: string,
  productId: string
): Promise<RunwayModel | null> {
  // NULL WHEN THE COMPANY HAS NOT SAID WHAT IT HAS. Everything below depends on
  // a cash balance, and Foundry has no way to observe one.
  const position = await getFinancialPosition(productId);
  if (position === null) return null;

  // Get latest metrics
  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 8',
    [productId]
  );
  const rows = metrics.rows as unknown as Array<Record<string, unknown>>;
  const m = rows[0];

  // THE LEVEL, NOT A SUM OF MOVEMENTS. This summed ONE period's
  // new + expansion − contraction − churned and called it monthly revenue,
  // while `mrr_cents` — the column that means where MRR IS — sat unread in the
  // same row. `types/index.ts` records this exact defect as fixed everywhere
  // else, splitting the two into `net_new_cents` and `level_cents` so that "no
  // reader can keep treating the movement as the level by accident". This was a
  // surviving reader.
  //
  // Worse than an approximation: the daily job writes a placeholder snapshot
  // carrying nothing but (id, product_id, snapshot_date), that row wins
  // ORDER BY snapshot_date DESC, and the four movement columns are INTEGER
  // DEFAULT 0 — so the sum was a confident 0. A company at $50k MRR, $60k burn
  // and $600k cash was told ten months of runway instead of sixty, and "Monthly
  // revenue: $0" went verbatim into the model prompt.
  //
  // The window widens to 8 so a placeholder row does not erase a level the
  // company reported last week.
  const level = rows
    .map((r) => r.mrr_cents as number | null)
    .find((c): c is number => typeof c === 'number');
  if (level === undefined) {
    // Same refusal as an unstated financial position: there is nothing to model
    // and inventing a revenue is how the last version got it wrong.
    return null;
  }
  const monthlyRevenue = level / 100;

  // Get business model for COGS
  const bm = await query('SELECT avg_cogs_per_customer FROM business_model_profile WHERE product_id = ?', [productId]);
  const cogsPerCustomer = (bm.rows[0] as Record<string, number> | undefined)?.avg_cogs_per_customer ?? 0;
  const activeUsers = (m?.active_users as number) ?? 0;
  const totalCogs = cogsPerCustomer * activeUsers;

  // Get founder health for personal runway
  const health = await query('SELECT personal_runway_months FROM founder_health WHERE founder_id = ?', [founderId]);
  const personalRunway = (health.rows[0] as Record<string, number> | undefined)?.personal_runway_months ?? null;

  // STATED, NOT ESTIMATED. Burn was `totalCogs + (30% of revenue, or $500)` and
  // cash was `revenue * 6`. COGS is still added on top of the stated burn only
  // where the founder's figure would not already include it — it would, so it
  // does not: their burn is their burn.
  const monthlyBurn = position.monthlyBurnCents / 100;
  const cashOnHand = position.cashOnHandCents / 100;
  const netCashFlow = monthlyRevenue - monthlyBurn;

  // Runway: null when the money is not running out. `999` was stored in
  // `runway_models.runway_months` and rendered as eighty-three years.
  const runwayMonths = netCashFlow >= 0 ? null : cashOnHand / Math.abs(netCashFlow);

  // Break-even calculation
  const growthRate = await estimateGrowthRate(productId);
  let breakEvenDate: string | null = null;
  let breakEvenMrr = monthlyBurn;
  if (monthlyRevenue < monthlyBurn && growthRate > 0) {
    const monthsToBreakEven = Math.log(monthlyBurn / Math.max(1, monthlyRevenue)) / Math.log(1 + growthRate);
    if (monthsToBreakEven > 0 && monthsToBreakEven < 120) {
      const beDate = new Date();
      beDate.setMonth(beDate.getMonth() + Math.ceil(monthsToBreakEven));
      breakEvenDate = beDate.toISOString().split('T')[0]!;
    }
  }

  // Gap: difference between founder runway and product break-even
  // NO BREAK-EVEN DATE MEANS NO GAP TO REPORT. This substituted 999 months to
  // break even and then, if the founder had no personal runway on file, a gap
  // of 0 — which reads as "your money lasts exactly as long as it needs to".
  const monthsToBreakEven = breakEvenDate
    ? Math.ceil((new Date(breakEvenDate).getTime() - Date.now()) / (30 * 86400000))
    : null;
  const gap = personalRunway !== null && monthsToBreakEven !== null
    ? monthsToBreakEven - personalRunway
    : null;

  const model: RunwayModel = {
    monthly_burn: Math.round(monthlyBurn),
    monthly_revenue: Math.round(monthlyRevenue),
    cash_on_hand: Math.round(cashOnHand),
    runway_months: runwayMonths === null ? null : Math.round(runwayMonths * 10) / 10,
    break_even_date: breakEvenDate,
    break_even_mrr: Math.round(breakEvenMrr),
    personal_runway_months: personalRunway,
    gap_months: gap === null ? null : Math.round(gap * 10) / 10,
  };

  // Persist
  await query(
    `INSERT INTO runway_models (id, founder_id, product_id, monthly_burn, monthly_revenue, cash_on_hand, runway_months, break_even_date, break_even_mrr, personal_runway_months, gap_months)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      nanoid(), founderId, productId,
      model.monthly_burn, model.monthly_revenue, model.cash_on_hand,
      model.runway_months, model.break_even_date, model.break_even_mrr,
      model.personal_runway_months, model.gap_months,
    ]
  );

  return model;
}

/**
 * Run a what-if scenario.
 */
export async function runWhatIfScenario(
  productId: string,
  ownerId: string,
  scenario: {
    name: string;
    type: 'pricing_change' | 'cost_reduction' | 'growth_acceleration' | 'headcount_change' | 'fundraise' | 'custom';
    inputs: Record<string, unknown>;
  }
): Promise<FinancialScenario> {
  const currentModel = await computeRunwayModel(ownerId, productId);
  // A what-if needs a what-is. Modelling a scenario against invented cash was
  // how this file produced twelve months of projections for companies whose
  // balance nobody knew.
  if (currentModel === null) {
    throw new Error('financial_position_required');
  }

  const prompt = `Model this financial scenario for a SaaS product.

Current state:
- Monthly revenue: $${currentModel.monthly_revenue}
- Monthly burn: $${currentModel.monthly_burn}
- Runway: ${currentModel.runway_months === null
    ? 'not running out — net cash flow is positive at the stated burn'
    : `${currentModel.runway_months} months`}
- Break-even MRR: $${currentModel.break_even_mrr}

Scenario: ${scenario.name}
Type: ${scenario.type}
Inputs: ${JSON.stringify(scenario.inputs)}

Project 12 months forward. Return JSON:
{
  "projections": [
    {"month": 1, "mrr": N, "customers": N, "burn": N, "net_cash_flow": N, "cumulative_cash": N, "runway_remaining": N},
    ...12 entries
  ],
  "assumptions": ["list of assumptions made"],
  "recommendations": ["specific actions based on this scenario"]
}`;

  const response = await callSonnet(
    'You are a SaaS financial modeler. Use realistic growth assumptions. Be conservative.',
    prompt,
    4096, productId
  );

  const result = parseJSONResponse<{
    projections: MonthlyProjection[];
    assumptions: string[];
    recommendations: string[];
  }>(response.content);

  const financialScenario: FinancialScenario = {
    id: nanoid(),
    scenario_name: scenario.name,
    scenario_type: scenario.type,
    inputs: scenario.inputs,
    projections: result.projections,
    assumptions: result.assumptions,
    recommendations: result.recommendations,
  };

  // Persist
  await query(
    `INSERT INTO financial_scenarios (id, product_id, owner_id, scenario_name, scenario_type, inputs, projections, assumptions, recommendations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      financialScenario.id, productId, ownerId,
      scenario.name, scenario.type,
      JSON.stringify(scenario.inputs),
      JSON.stringify(result.projections),
      JSON.stringify(result.assumptions),
      JSON.stringify(result.recommendations),
    ]
  );

  return financialScenario;
}

/**
 * Compare current trajectory against founder's personal runway.
 */
export async function analyzeRunwayGap(founderId: string, productId: string): Promise<{
  has_gap: boolean;
  /** NULL when the gap could not be computed. It used to be 0 alongside
   *  `severity: 'safe'`, which told a founder their runway was fine as the
   *  answer to a question nobody could answer. */
  gap_months: number | null;
  severity: 'safe' | 'tight' | 'critical' | 'unknown';
  recommendation: string;
}> {
  const model = await computeRunwayModel(founderId, productId);

  if (model === null) {
    return {
      has_gap: false,
      gap_months: null,
      severity: 'unknown',
      recommendation: 'Tell Foundry your cash on hand and monthly burn on the Scenarios page — a runway gap cannot be computed without them.',
    };
  }

  if (model.personal_runway_months === null) {
    return {
      has_gap: false,
      gap_months: null,
      severity: 'unknown',
      recommendation: 'Set your personal runway in Founder Health to enable runway gap analysis.',
    };
  }

  const gap = model.gap_months;
  if (gap === null) {
    return {
      has_gap: false,
      gap_months: null,
      severity: 'unknown',
      recommendation: 'No break-even date could be projected, so there is nothing to compare your personal runway against.',
    };
  }

  if (gap <= 0) {
    return {
      has_gap: false,
      gap_months: gap,
      severity: 'safe',
      recommendation: 'Your personal runway exceeds your break-even timeline. You have margin.',
    };
  }

  const severity = gap > 6 ? 'critical' : gap > 3 ? 'tight' : 'safe';

  let recommendation: string;
  if (severity === 'critical') {
    recommendation = `Critical: ${gap.toFixed(0)} month gap between your runway (${model.personal_runway_months} months) and break-even (${model.break_even_date}). Options: accelerate revenue, cut burn, raise capital, or extend personal runway.`;
  } else if (severity === 'tight') {
    recommendation = `Tight: ${gap.toFixed(0)} month gap. You need to either accelerate growth by ${Math.ceil(gap * model.monthly_burn / 12)}$/mo or reduce burn by ${Math.ceil(model.monthly_burn * 0.2)}/mo.`;
  } else {
    recommendation = 'Runway gap is manageable. Stay focused on growth.';
  }

  return { has_gap: gap > 0, gap_months: gap, severity, recommendation };
}

/**
 * Get saved scenarios for a product.
 */
export async function getSavedScenarios(productId: string): Promise<FinancialScenario[]> {
  const result = await query(
    'SELECT * FROM financial_scenarios WHERE product_id = ? ORDER BY created_at DESC LIMIT 10',
    [productId]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    scenario_name: row.scenario_name as string,
    scenario_type: row.scenario_type as string,
    inputs: JSON.parse(row.inputs as string),
    projections: JSON.parse(row.projections as string),
    assumptions: JSON.parse(row.assumptions as string),
    recommendations: JSON.parse(row.recommendations as string),
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Stated, not measured: what growth to assume when the level has not moved
 *  across two reported snapshots. Named so it reads as an assumption. */
const DEFAULT_GROWTH_RATE = 0.05;

/** Monthly growth of the MRR LEVEL, from the oldest and newest snapshots that
 *  carry one.
 *
 *  Two errors, compounding. It grew `new + expansion` — a MOVEMENT, and only
 *  the positive half of one, ignoring contraction and churn entirely — and then
 *  raised the ratio to `1 / (rows.length - 1)`, treating each snapshot as one
 *  month. Snapshots are written DAILY, so six rows spanning five days had their
 *  five-day change reported as a five-MONTH compound rate. The result is
 *  multiplied into a break-even projection.
 *
 *  The dates are in the rows, so the window is measured rather than assumed. */
async function estimateGrowthRate(productId: string): Promise<number> {
  const metrics = await query(
    'SELECT mrr_cents, snapshot_date FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 30',
    [productId]
  );
  const levels = (metrics.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({ cents: r.mrr_cents as number | null, date: String(r.snapshot_date ?? '') }))
    .filter((r): r is { cents: number; date: string } => typeof r.cents === 'number');
  if (levels.length < 2) return DEFAULT_GROWTH_RATE;

  const newest = levels[0]!;
  const oldest = levels[levels.length - 1]!;
  if (oldest.cents <= 0) return DEFAULT_GROWTH_RATE;

  const a = Date.parse(`${oldest.date}T00:00:00Z`);
  const b = Date.parse(`${newest.date}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return DEFAULT_GROWTH_RATE;
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return DEFAULT_GROWTH_RATE;

  const monthly = Math.pow(newest.cents / oldest.cents, 30 / days) - 1;
  return Number.isFinite(monthly) ? monthly : DEFAULT_GROWTH_RATE;
}
