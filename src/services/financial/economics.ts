// =============================================================================
// FOUNDRY — Financial Autonomy: AI Company P&L and Economics
// Tracks costs, revenue attribution, and ROI for the autonomous agent suite.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AICompanyPL {
  period: { start: string; end: string };
  revenue: {
    total_usd: number;
    by_agent: Record<string, number>;
    by_type: Record<string, number>;
  };
  costs: {
    total_usd: number;
    by_agent: Record<string, number>;
    by_type: Record<string, number>;
  };
  profit_usd: number;
  roi: number;
  self_funding: boolean;
}

// ─── P&L ─────────────────────────────────────────────────────────────────────

/**
 * Get the AI Company P&L for a product (trailing 30 days by default).
 */
export async function getAICompanyPL(
  productId: string,
  days: number = 30,
): Promise<AICompanyPL> {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const now = new Date().toISOString();

  // Costs
  const costResult = await query(
    `SELECT agent_name, cost_type, SUM(amount_usd) as total
     FROM cost_events
     WHERE product_id = ? AND created_at >= ?
     GROUP BY agent_name, cost_type`,
    [productId, since],
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
  const revenueResult = await query(
    `SELECT agent_name, attribution_type, SUM(amount_usd * confidence) as total
     FROM revenue_attributions
     WHERE product_id = ? AND period_start >= ?
     GROUP BY agent_name, attribution_type`,
    [productId, since],
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
  const roi = totalCosts > 0 ? profit / totalCosts : 0;

  return {
    period: { start: since, end: now },
    revenue: {
      total_usd: totalRevenue,
      by_agent: revenueByAgent,
      by_type: revenueByType,
    },
    costs: {
      total_usd: totalCosts,
      by_agent: costsByAgent,
      by_type: costsByType,
    },
    profit_usd: profit,
    roi,
    self_funding: totalRevenue >= totalCosts,
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
  roi: number;
}>> {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const costResult = await query(
    `SELECT agent_name,
            SUM(amount_usd) as total_cost,
            SUM(CASE WHEN cost_type = 'llm_tokens' THEN amount_usd ELSE 0 END) as llm_cost,
            SUM(CASE WHEN cost_type = 'integration_api' THEN amount_usd ELSE 0 END) as integration_cost
     FROM cost_events
     WHERE product_id = ? AND created_at >= ? AND agent_name IS NOT NULL
     GROUP BY agent_name`,
    [productId, since],
  );

  const revenueResult = await query(
    `SELECT agent_name, SUM(amount_usd * confidence) as attributed_revenue
     FROM revenue_attributions
     WHERE product_id = ? AND period_start >= ?
     GROUP BY agent_name`,
    [productId, since],
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
    const roi = totalCost > 0 ? (attributedRevenue - totalCost) / totalCost : 0;

    return {
      agent_name: agentName,
      total_cost_usd: totalCost,
      llm_cost_usd: llmCost,
      integration_cost_usd: integrationCost,
      attributed_revenue_usd: attributedRevenue,
      roi,
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
}): Promise<void> {
  await query(
    `INSERT INTO cost_events (id, product_id, agent_name, cost_type, amount_usd, details_json, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      params.productId,
      params.agentName ?? null,
      params.costType,
      params.amountUsd,
      params.details ? JSON.stringify(params.details) : null,
      params.sessionId ?? null,
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

  // Current month spend
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const spendResult = await query(
    `SELECT SUM(amount_usd) as total FROM cost_events
     WHERE product_id = ? AND created_at >= ?`,
    [productId, monthStart],
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
  roi_ratio: number;
  top_roi_agent: string;
  bottom_roi_agent: string;
}> {
  const breakdown = await getAgentCostBreakdown(productId, 30);

  const totalCost = breakdown.reduce((sum, a) => sum + a.total_cost_usd, 0);
  const totalRevenue = breakdown.reduce((sum, a) => sum + a.attributed_revenue_usd, 0);
  const roiRatio = totalCost > 0 ? totalRevenue / totalCost : 0;

  const sorted = [...breakdown].sort((a, b) => b.roi - a.roi);
  const topAgent = sorted[0]?.agent_name ?? 'none';
  const bottomAgent = sorted[sorted.length - 1]?.agent_name ?? 'none';

  return {
    total_cost_30d: totalCost,
    attributed_revenue_30d: totalRevenue,
    roi_ratio: roiRatio,
    top_roi_agent: topAgent,
    bottom_roi_agent: bottomAgent,
  };
}
