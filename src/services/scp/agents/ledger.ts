// =============================================================================
// FOUNDRY — Ledger Agent (CFO)
// Domain: Revenue tracking, financial health, AI ROI analysis
// Cadence: 24 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface LedgerClaudeResponse {
  observations: string[];
  financial_alerts: Array<{
    type: 'budget_alert' | 'roi_opportunity' | 'cost_spike' | 'revenue_flag';
    title: string;
    description: string;
  }>;
  roi: number;
  budget_utilization_pct: number;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class LedgerAgent extends BaseAgent {
  getName(): AgentName { return 'ledger'; }
  getRole(): string { return 'CFO'; }
  getActivationCadenceHours(): number { return 24; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query last 4 metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT new_mrr_cents, churned_mrr_cents, expansion_mrr_cents,
              contraction_mrr_cents, mrr_health_ratio, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 4`,
      [productId]
    );

    // ── 2. Query agent_cost_log for last 30 days per agent ────────────────────
    const agentCostResult = await db(
      `SELECT agent_name,
              SUM(cost_usd) as total_cost_usd,
              SUM(attributed_revenue_usd) as total_attributed_revenue_usd,
              COUNT(*) as session_count
       FROM agent_cost_log
       WHERE product_id = ?
         AND logged_at >= datetime('now', '-30 days')
       GROUP BY agent_name
       ORDER BY total_cost_usd DESC`,
      [productId]
    );

    // ── 3. Query products for budget and cost columns ─────────────────────────
    const productResult = await db(
      `SELECT ai_cost_trailing_30d_usd, operating_budget_monthly_usd,
              attributed_revenue_trailing_30d_usd
       FROM products
       WHERE id = ?`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0 && productResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No financial data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting financial metrics',
      };
      return {
        observations: ['No financial data available yet — Ledger will track revenue and AI ROI as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Ledger is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];

    // Build MRR series (newest first)
    const mrrSeries = metricRows.map(row => {
      const date = row.snapshot_date as string;
      const newMrr = (Number(row.new_mrr_cents) || 0) / 100;
      const churned = (Number(row.churned_mrr_cents) || 0) / 100;
      const expansion = (Number(row.expansion_mrr_cents) || 0) / 100;
      return `${date}: new=$${newMrr.toFixed(2)} churned=$${churned.toFixed(2)} expansion=$${expansion.toFixed(2)}`;
    }).join(' | ');

    const productRow = productResult.rows.length > 0
      ? (productResult.rows[0] as Record<string, unknown>)
      : null;
    const aiCostTotal = productRow ? Number(productRow.ai_cost_trailing_30d_usd) || 0 : 0;
    const budget = productRow ? Number(productRow.operating_budget_monthly_usd) || 50 : 50;
    const attributedRevenue = productRow ? Number(productRow.attributed_revenue_trailing_30d_usd) || 0 : 0;

    // Build per-agent cost breakdown
    const agentCostRows = agentCostResult.rows as Record<string, unknown>[];
    const agentCostBreakdown = agentCostRows.length > 0
      ? agentCostRows.map(r =>
          `${r.agent_name as string}: cost=$${(Number(r.total_cost_usd) || 0).toFixed(4)} ` +
          `attributed=$${(Number(r.total_attributed_revenue_usd) || 0).toFixed(2)} ` +
          `(${r.session_count as number} sessions)`
        ).join(', ')
      : 'No agent cost data yet';

    const roi = aiCostTotal > 0 ? attributedRevenue / aiCostTotal : 0;
    const budgetUtilization = budget > 0 ? (aiCostTotal / budget) * 100 : 0;

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Ledger, the CFO agent for ${companyName}. You track financial health and the ROI of AI operations. Identify budget risks, cost spikes, and revenue opportunities. Be precise with numbers.`
    );

    const userPrompt = `MRR last ${metricRows.length} periods (newest first): ${mrrSeries || 'No MRR data'}.
Total AI cost (30d): $${aiCostTotal.toFixed(4)}. Budget: $${budget.toFixed(2)}/month. Budget utilization: ${budgetUtilization.toFixed(1)}%.
Agent cost breakdown: ${agentCostBreakdown}.
Attributed revenue (30d): $${attributedRevenue.toFixed(2)}.
Calculated ROI: ${roi.toFixed(2)}x (attributed revenue / AI cost).

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "financial_alerts": [
    {
      "type": "budget_alert" | "roi_opportunity" | "cost_spike" | "revenue_flag",
      "title": "string",
      "description": "string"
    }
  ],
  "roi": number,
  "budget_utilization_pct": number,
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: LedgerClaudeResponse;
    try {
      parsed = parseJSONResponse<LedgerClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Ledger encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Ledger experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 7. Ledger does not create decisions — it's inform-only (authority 1) ──
    // Budget alerts and ROI insights are observations only in financial domain.
    // No AgentDecisions — Ledger's authority level is 1 (notify).
    const pendingDecisions: AgentDecision[] = [];

    // ── 8. Record analysis action ─────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed financial analysis: AI cost $${aiCostTotal.toFixed(4)}, budget utilization ${budgetUtilization.toFixed(1)}%, ROI ${roi.toFixed(2)}x`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Ledger completed financial review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default LedgerAgent;
