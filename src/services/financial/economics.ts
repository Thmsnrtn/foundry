// =============================================================================
// FOUNDRY — Financial Autonomy: AI Company P&L and Economics
//
// ONE HALF OF THIS P&L IS MEASURED AND THE OTHER HALF IS FOUNDRY'S OPINION OF
// ITSELF, AND EVERY NUMBER BUILT FROM BOTH INHERITS THE OPINION.
//
// Costs are real: `cost_events` rows are written by the agent runner from token
// counts actually spent. Revenue is not. `revenue_attributions` is written by
// ONE caller — the Ledger agent — from a language model's estimate of how much
// revenue another agent's action produced, with a confidence the same model
// assigned to its own estimate, filtered at `> 0.6` and then multiplied by that
// confidence. Nothing reconciles it against Stripe, an invoice, or a customer.
//
// That is a legitimate thing to show a founder, LABELLED. What is not
// legitimate is subtracting it from a measured cost and calling the difference
// "Profit", dividing by cost and calling it "ROI", or comparing the two and
// answering "Self-Funding: Yes" — which is Foundry stating that it pays for
// itself, on the strength of its own guess about what it earned.
//
// So the shape of every field here says which half it came from:
// `attributed_*` for anything derived from those estimates, and the page and
// the strategy prompt both carry the provenance rather than the number alone.
// An unmeasured ratio is NULL, not 0: with no cost recorded, "ROI 0%" was the
// answer for every company that had not run an agent yet.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AICompanyPL {
  period: { start: string; end: string };
  /** Foundry's own estimate of revenue its actions produced, weighted by the
   *  confidence the estimate carried. Not measured revenue. */
  attributed_revenue: {
    total_usd: number;
    by_agent: Record<string, number>;
    by_type: Record<string, number>;
  };
  /** Measured: token and integration spend actually incurred. */
  costs: {
    total_usd: number;
    by_agent: Record<string, number>;
    by_type: Record<string, number>;
  };
  /** Attributed revenue minus measured cost. Half opinion, by construction. */
  attributed_profit_usd: number;
  /** NULL when no cost was recorded — an unmeasured ratio, not a ratio of 0. */
  attributed_roi: number | null;
  /** Whether the ATTRIBUTED revenue covers the measured cost. Deliberately not
   *  called `self_funding`: that is a claim about the world, and this is a
   *  comparison against Foundry's own estimate. */
  attributed_revenue_covers_cost: boolean;
}

// ─── P&L ─────────────────────────────────────────────────────────────────────

/**
 * Get the AI Company P&L for a product (trailing 30 days by default).
 */
export async function getAICompanyPL(
  productId: string,
  days: number = 30,
): Promise<AICompanyPL> {
  // Reported as the period's label; the queries below ask SQLite for the bound.
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const now = new Date().toISOString();

  // Costs
  // ONE FORMAT ON BOTH SIDES. `created_at` defaults to CURRENT_TIMESTAMP, which
  // SQLite writes as 'YYYY-MM-DD HH:MM:SS'; the bound was a JavaScript
  // `toISOString()`, 'YYYY-MM-DDTHH:MM:SS.sssZ'. These are compared as TEXT, and
  // at index 10 a space (0x20) sorts before 'T' (0x54) — so every row written on
  // the boundary DATE compared as earlier than the boundary whatever its time,
  // and a "trailing 30 days" window silently dropped its oldest day. Asking
  // SQLite for the bound keeps both sides in SQLite's format.
  const costResult = await query(
    `SELECT agent_name, cost_type, SUM(amount_usd) as total
     FROM cost_events
     WHERE product_id = ? AND created_at >= datetime('now', ? || ' days')
     GROUP BY agent_name, cost_type`,
    [productId, `-${days}`],
  );

  const costsByAgent: Record<string, number> = {};
  const costsByType: Record<string, number> = {};
  let totalCosts = 0;

  for (const row of costResult.rows) {
    const r = row as Record<string, unknown>;
    const agentName = (r.agent_name as string | null) ?? 'platform';
    const costType = r.cost_type as string;
    const total = (r.total as number) ?? 0;

    costsByAgent[agentName] = (costsByAgent[agentName] ?? 0) + total;
    costsByType[costType] = (costsByType[costType] ?? 0) + total;
    totalCosts += total;
  }

  // Revenue attributions
  // WINDOWED ON `created_at`, NOT `period_start`, AND THAT WAS NOT COSMETIC.
  //
  // `logRevenue` stores `period_start = now - 30 days` and `period_end = now`:
  // the row describes the period the revenue is attributed OVER. This query
  // asked for `period_start >= now - 30 days`, evaluated later than the write,
  // so the attribution's own start was ALWAYS a hair before the boundary and
  // ALWAYS excluded. Attributed revenue was therefore 0 for every company, in
  // every window, since the P&L was written — which made "Profit" the negative
  // of cost, ROI -100%, and "Self-Funding: No" the permanent answer.
  //
  // `created_at` is when Foundry recorded the attribution, which is the
  // question a trailing-30-days P&L is asking.
  const revenueResult = await query(
    `SELECT agent_name, attribution_type, SUM(amount_usd * confidence) as total
     FROM revenue_attributions
     WHERE product_id = ? AND created_at >= datetime('now', ? || ' days')
     GROUP BY agent_name, attribution_type`,
    [productId, `-${days}`],
  );

  const revenueByAgent: Record<string, number> = {};
  const revenueByType: Record<string, number> = {};
  let totalRevenue = 0;

  for (const row of revenueResult.rows) {
    const r = row as Record<string, unknown>;
    const agentName = r.agent_name as string;
    const attrType = r.attribution_type as string;
    const total = (r.total as number) ?? 0;

    revenueByAgent[agentName] = (revenueByAgent[agentName] ?? 0) + total;
    revenueByType[attrType] = (revenueByType[attrType] ?? 0) + total;
    totalRevenue += total;
  }

  const profit = totalRevenue - totalCosts;

  return {
    period: { start: since, end: now },
    attributed_revenue: {
      total_usd: totalRevenue,
      by_agent: revenueByAgent,
      by_type: revenueByType,
    },
    costs: {
      total_usd: totalCosts,
      by_agent: costsByAgent,
      by_type: costsByType,
    },
    attributed_profit_usd: profit,
    attributed_roi: totalCosts > 0 ? profit / totalCosts : null,
    attributed_revenue_covers_cost: totalRevenue >= totalCosts,
  };
}

// ─── Per-Agent Breakdown ──────────────────────────────────────────────────────

/**
 * Get per-agent cost breakdown (trailing N days).
 */
export async function getAgentCostBreakdown(
  productId: string,
  days: number = 30,
): Promise<Array<{
  agent_name: string;
  total_cost_usd: number;
  llm_cost_usd: number;
  integration_cost_usd: number;
  attributed_revenue_usd: number;
  /** NULL when this agent recorded no cost in the window. */
  attributed_roi: number | null;
}>> {
  const costResult = await query(
    `SELECT agent_name,
            SUM(amount_usd) as total_cost,
            SUM(CASE WHEN cost_type = 'llm_tokens' THEN amount_usd ELSE 0 END) as llm_cost,
            SUM(CASE WHEN cost_type = 'integration_api' THEN amount_usd ELSE 0 END) as integration_cost
     FROM cost_events
     WHERE product_id = ? AND created_at >= datetime('now', ? || ' days')
       AND agent_name IS NOT NULL
     GROUP BY agent_name`,
    [productId, `-${days}`],
  );

  // `created_at`, for the reason given in `getAICompanyPL`: an attribution's
  // `period_start` is 30 days BEFORE it was written, so a 30-day window keyed
  // on it excluded every row that had ever been written.
  const revenueResult = await query(
    `SELECT agent_name, SUM(amount_usd * confidence) as attributed_revenue
     FROM revenue_attributions
     WHERE product_id = ? AND created_at >= datetime('now', ? || ' days')
     GROUP BY agent_name`,
    [productId, `-${days}`],
  );

  const revenueByAgent: Record<string, number> = {};
  for (const row of revenueResult.rows) {
    const r = row as Record<string, unknown>;
    revenueByAgent[r.agent_name as string] = (r.attributed_revenue as number) ?? 0;
  }

  return costResult.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const agentName = r.agent_name as string;
    const totalCost = (r.total_cost as number) ?? 0;
    const llmCost = (r.llm_cost as number) ?? 0;
    const integrationCost = (r.integration_cost as number) ?? 0;
    const attributedRevenue = revenueByAgent[agentName] ?? 0;
    const roi = totalCost > 0 ? (attributedRevenue - totalCost) / totalCost : null;

    return {
      agent_name: agentName,
      total_cost_usd: totalCost,
      llm_cost_usd: llmCost,
      integration_cost_usd: integrationCost,
      attributed_revenue_usd: attributedRevenue,
      attributed_roi: roi,
    };
  });
}

// ─── Cost Logging ─────────────────────────────────────────────────────────────

/**
 * Log a cost event.
 */
export async function logCost(params: {
  productId: string;
  agentName?: string;
  costType: 'llm_tokens' | 'integration_api' | 'email_send' | 'compute' | 'experiment' | 'other';
  amountUsd: number;
  details?: Record<string, unknown>;
  sessionId?: string;
  /** Institutional attribution (migration 134). A persona is not a unit of
   * company work; a responsibility is. Optional because pre-institutional
   * callers exist, and booking their spend against an invented responsibility
   * would be worse than leaving it unattributed. */
  responsibilityId?: string;
  capability?: string;
}): Promise<void> {
  await query(
    `INSERT INTO cost_events (id, product_id, agent_name, cost_type, amount_usd, details_json, session_id,
       responsibility_id, capability)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      params.productId,
      params.agentName ?? null,
      params.costType,
      params.amountUsd,
      params.details ? JSON.stringify(params.details) : null,
      params.sessionId ?? null,
      params.responsibilityId ?? null,
      params.capability ?? null,
    ],
  );
}

// ─── Revenue Logging ──────────────────────────────────────────────────────────

/**
 * Log a revenue attribution record.
 */
export async function logRevenue(params: {
  productId: string;
  attributionType: 'direct' | 'experiment' | 'contribution' | 'protective';
  agentName: string;
  amountUsd: number;
  confidence: number;
  description: string;
  evidence?: Record<string, unknown>;
  periodDays?: number;
}): Promise<void> {
  const periodDays = params.periodDays ?? 30;
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - periodDays * 86400 * 1000).toISOString();

  await query(
    `INSERT INTO revenue_attributions
       (id, product_id, attribution_type, agent_name, amount_usd, confidence,
        description, evidence_json, period_start, period_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      params.productId,
      params.attributionType,
      params.agentName,
      params.amountUsd,
      params.confidence,
      params.description,
      params.evidence ? JSON.stringify(params.evidence) : null,
      periodStart,
      periodEnd,
    ],
  );
}

// ─── Budget Utilization ───────────────────────────────────────────────────────

/**
 * Get monthly budget utilization vs operating_budget_monthly_usd.
 */
export async function getBudgetUtilization(productId: string): Promise<{
  budget_usd: number;
  spent_usd: number;
  utilization_pct: number;
  status: 'ok' | 'warning' | 'critical';
  days_remaining_in_month: number;
  projected_month_total: number;
}> {
  // Get budget from products table (may not exist yet — default to 500)
  const prodResult = await query(
    'SELECT operating_budget_monthly_usd FROM products WHERE id = ?',
    [productId],
  ).catch(() => ({ rows: [] }));

  const prodRow = prodResult.rows[0] as Record<string, unknown> | undefined;
  const budgetUsd = (prodRow?.operating_budget_monthly_usd as number | null) ?? 500;

  // CURRENT MONTH SPEND, IN THE DATABASE'S CALENDAR AND THE DATABASE'S FORMAT.
  //
  // Two problems in one line. `new Date(y, m, 1)` builds LOCAL midnight and
  // `.toISOString()` then converts it to UTC, so on a host east of Greenwich
  // the "start of month" landed in the previous month and the bar counted a day
  // that belongs to the last bill. And the result was an ISO string compared as
  // text against CURRENT_TIMESTAMP values, where a space sorts before 'T' — so
  // everything written on the first of the month was excluded anyway.
  const now = new Date();

  const spendResult = await query(
    `SELECT SUM(amount_usd) as total FROM cost_events
     WHERE product_id = ? AND created_at >= datetime('now', 'start of month')`,
    [productId],
  );

  const spentUsd = ((spendResult.rows[0] as Record<string, unknown>)?.total as number) ?? 0;
  const utilizationPct = budgetUsd > 0 ? (spentUsd / budgetUsd) * 100 : 0;

  // Days remaining in month
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = lastDayOfMonth - now.getDate();
  const daysPassed = now.getDate();
  const projectedMonthTotal = daysPassed > 0 ? (spentUsd / daysPassed) * lastDayOfMonth : spentUsd;

  let status: 'ok' | 'warning' | 'critical' = 'ok';
  if (utilizationPct >= 95) status = 'critical';
  else if (utilizationPct >= 80) status = 'warning';

  return {
    budget_usd: budgetUsd,
    spent_usd: spentUsd,
    utilization_pct: utilizationPct,
    status,
    days_remaining_in_month: daysRemaining,
    projected_month_total: projectedMonthTotal,
  };
}

// ─── ROI Summary ──────────────────────────────────────────────────────────────

/**
 * Compute the company's ROI summary for CEO briefing.
 */
export async function getROISummary(productId: string): Promise<{
  total_cost_30d: number;
  attributed_revenue_30d: number;
  /** NULL when no cost was recorded in the window. */
  attributed_roi_ratio: number | null;
  /** NULL when no agent recorded a cost, so no agent can be ranked. */
  top_attributed_roi_agent: string | null;
  bottom_attributed_roi_agent: string | null;
  /** Travels with the numbers, because both consumers hand them to a reader. */
  provenance: string;
}> {
  const breakdown = await getAgentCostBreakdown(productId, 30);

  const totalCost = breakdown.reduce((sum, a) => sum + a.total_cost_usd, 0);
  const totalRevenue = breakdown.reduce((sum, a) => sum + a.attributed_revenue_usd, 0);

  // Only agents with a measured cost can be ranked by a ratio that divides by
  // it. `'none'` used to be returned as an agent name for both ends.
  const ranked = breakdown
    .filter((a): a is typeof a & { attributed_roi: number } => a.attributed_roi !== null)
    .sort((a, b) => b.attributed_roi - a.attributed_roi);

  return {
    total_cost_30d: totalCost,
    attributed_revenue_30d: totalRevenue,
    attributed_roi_ratio: totalCost > 0 ? totalRevenue / totalCost : null,
    top_attributed_roi_agent: ranked[0]?.agent_name ?? null,
    bottom_attributed_roi_agent: ranked.length > 0 ? ranked[ranked.length - 1].agent_name : null,
    provenance: 'Costs are measured token and integration spend. Attributed revenue is '
      + "Foundry's own estimate of revenue its actions produced, weighted by the confidence "
      + 'the estimate carried, and reconciled against nothing. Every ratio here compares a '
      + 'measured cost with an estimate.',
  };
}
