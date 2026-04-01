// =============================================================================
// FOUNDRY — Ledger Agent (CFO)
// Domain: Revenue tracking, financial health, AI ROI analysis, burn analysis
// Cadence: 24 hours
// v2: Emits outboundActions for budget alerts, agentMessages to Forge/broadcast,
//     logs revenue attributions via economics.logRevenue
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { logRevenue } from '../../financial/economics.js';

interface LedgerClaudeResponse {
  observations: string[];
  financial_health: {
    mrr_trend: 'growing' | 'flat' | 'declining';
    nrr_estimate: number;
    ai_roi_ratio: number;
    budget_utilization_pct: number;
    runway_months_estimate: number | null;
    risk_flags: string[];
  };
  financial_recommendations: Array<{
    type: 'budget_alert' | 'roi_opportunity' | 'cost_optimization' | 'revenue_protection';
    title: string;
    description: string;
    estimated_impact_usd: number;
    authority_level: 0 | 1 | 2;
  }>;
  revenue_attributions: Array<{
    agent_name: string;
    action_description: string;
    estimated_revenue_usd: number;
    confidence: number;
    attribution_type: 'direct' | 'contribution' | 'protective';
  }>;
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

    // ── 1. Query last 4 metric_snapshots for MRR trend ────────────────────────
    const metricsResult = await db(
      `SELECT new_mrr_cents, churned_mrr_cents, expansion_mrr_cents,
              contraction_mrr_cents, mrr_health_ratio, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 4`,
      [productId]
    );

    // ── 2. Query cost_events for last 30 days ─────────────────────────────────
    const costResult = await db(
      `SELECT SUM(amount_usd) as total_cost_usd, COUNT(*) as event_count
       FROM cost_events
       WHERE product_id = ?
         AND created_at >= datetime('now', '-30 days')`,
      [productId]
    );

    // ── 3. Query revenue_attributions last 30 days ────────────────────────────
    const revenueAttrResult = await db(
      `SELECT agent_name, SUM(amount_usd) as total_revenue_usd,
              COUNT(*) as attribution_count
       FROM revenue_attributions
       WHERE product_id = ?
         AND period_end >= datetime('now', '-30 days')
       GROUP BY agent_name`,
      [productId]
    );

    // ── 4. Query outbound_actions executed in last 30 days ────────────────────
    const executedActionsResult = await db(
      `SELECT agent_name, COUNT(*) as executed_count,
              SUM(estimated_value_usd) as total_estimated_value_usd
       FROM outbound_actions
       WHERE product_id = ?
         AND status = 'executed'
         AND executed_at >= datetime('now', '-30 days')
       GROUP BY agent_name`,
      [productId]
    );

    // ── 5. Query products for budget context ──────────────────────────────────
    const productResult = await db(
      `SELECT ai_cost_trailing_30d_usd, operating_budget_monthly_usd,
              attributed_revenue_trailing_30d_usd
       FROM products
       WHERE id = ?`,
      [productId]
    );

    // ── 6. Handle no-data case ────────────────────────────────────────────────
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

    // ── 7. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];
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

    const costRow = costResult.rows.length > 0 ? (costResult.rows[0] as Record<string, unknown>) : null;
    const directCost = costRow ? Number(costRow.total_cost_usd) || 0 : aiCostTotal;

    const revenueAttrRows = revenueAttrResult.rows as Record<string, unknown>[];
    const revenueBreakdown = revenueAttrRows.length > 0
      ? revenueAttrRows.map(r =>
          `${r.agent_name as string}: $${(Number(r.total_revenue_usd) || 0).toFixed(2)} (${r.attribution_count as number} attributions)`
        ).join(', ')
      : 'No attributions logged yet';

    const executedRows = executedActionsResult.rows as Record<string, unknown>[];
    const executedContext = executedRows.length > 0
      ? executedRows.map(r =>
          `${r.agent_name as string}: ${r.executed_count as number} actions, est. value $${(Number(r.total_estimated_value_usd) || 0).toFixed(2)}`
        ).join(', ')
      : 'No executed actions in 30d';

    const roi = aiCostTotal > 0 ? attributedRevenue / aiCostTotal : 0;
    const budgetUtilization = budget > 0 ? (aiCostTotal / budget) * 100 : 0;

    // Stripe integration events
    const stripeEvents = (context.integrationEvents ?? []).filter(e => e.source === 'stripe');
    const stripeContext = stripeEvents.length > 0
      ? `Stripe signals: ${stripeEvents.map(e => `[${e.event_type}] ${e.summary}`).join(' | ')}`
      : 'No Stripe events';

    // ── 8. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Ledger, the CFO agent for ${companyName}. You track financial health, analyze AI ROI, and flag budget risks. Be precise with numbers. Identify opportunities to improve revenue retention and AI cost efficiency.`
    );

    const userPrompt = `MRR last ${metricRows.length} periods (newest first): ${mrrSeries || 'No MRR data'}.
Total AI cost (30d): $${directCost.toFixed(4)}. Budget: $${budget.toFixed(2)}/month. Utilization: ${budgetUtilization.toFixed(1)}%.
Attributed revenue (30d): $${attributedRevenue.toFixed(2)}. Calculated ROI: ${roi.toFixed(2)}x.
Revenue by agent: ${revenueBreakdown}.
Executed actions (30d): ${executedContext}.
${stripeContext}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "financial_health": {
    "mrr_trend": "growing" | "flat" | "declining",
    "nrr_estimate": number (Net Revenue Retention %),
    "ai_roi_ratio": number (attributed_revenue / ai_cost),
    "budget_utilization_pct": number,
    "runway_months_estimate": number | null,
    "risk_flags": ["string", ...]
  },
  "financial_recommendations": [
    {
      "type": "budget_alert" | "roi_opportunity" | "cost_optimization" | "revenue_protection",
      "title": "string",
      "description": "string",
      "estimated_impact_usd": number,
      "authority_level": 0 | 1 | 2
    }
  ],
  "revenue_attributions": [
    {
      "agent_name": "string",
      "action_description": "string",
      "estimated_revenue_usd": number,
      "confidence": number (0-1),
      "attribution_type": "direct" | "contribution" | "protective"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000);
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

    // ── 9. Log revenue attributions fire-and-forget ───────────────────────────
    const health = parsed.financial_health;
    for (const attr of (parsed.revenue_attributions ?? [])) {
      if (attr.confidence > 0.6) {
        logRevenue({
          productId,
          attributionType: attr.attribution_type === 'direct' ? 'direct'
            : attr.attribution_type === 'protective' ? 'protective'
            : 'contribution',
          agentName: attr.agent_name,
          amountUsd: attr.estimated_revenue_usd,
          confidence: attr.confidence,
          description: attr.action_description,
        }).catch(() => { /* fire-and-forget */ });
      }
    }

    // ── 10. Build outbound actions for budget alerts ───────────────────────────
    const outboundActions: OutboundActionSignal[] = [];
    for (const rec of (parsed.financial_recommendations ?? [])) {
      if (rec.type === 'budget_alert' && rec.authority_level <= 1) {
        outboundActions.push({
          action_type: 'budget_alert',
          description: rec.description,
          parameters: {
            title: rec.title,
            estimated_impact_usd: rec.estimated_impact_usd,
            budget_utilization_pct: health?.budget_utilization_pct ?? budgetUtilization,
          },
          authority_level: 1,
          estimated_value_usd: rec.estimated_impact_usd,
        });
      }
    }

    // ── 11. Build agent messages ──────────────────────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];

    // Broadcast budget warning when utilization > 80%
    const utilPct = health?.budget_utilization_pct ?? budgetUtilization;
    if (utilPct > 80) {
      agentMessages.push({
        to_agent: 'broadcast',
        message_type: 'alert',
        priority: utilPct > 95 ? 'critical' : 'high',
        subject: `Budget utilization at ${utilPct.toFixed(1)}% — AI cost review needed`,
        body: `Ledger reports budget utilization at ${utilPct.toFixed(1)}% for the month. AI costs: $${directCost.toFixed(4)}. Budget cap: $${budget.toFixed(2)}. All agents should minimize unnecessary Claude calls until next billing cycle.`,
      });
    }

    // Alert Forge when NRR < 90%
    const nrr = health?.nrr_estimate ?? 100;
    if (nrr < 90) {
      agentMessages.push({
        to_agent: 'forge',
        message_type: 'alert',
        priority: nrr < 80 ? 'critical' : 'high',
        subject: `NRR below threshold: ${nrr.toFixed(1)}% — revenue retention at risk`,
        body: `Ledger estimates Net Revenue Retention at ${nrr.toFixed(1)}%. This signals contraction or churn is outpacing expansion. Forge should review pricing strategy and expansion opportunities. MRR trend: ${health?.mrr_trend ?? 'unknown'}.`,
      });
    }

    // Broadcast runway warning when < 3 months
    const runway = health?.runway_months_estimate;
    if (runway !== null && runway !== undefined && runway < 3) {
      agentMessages.push({
        to_agent: 'broadcast',
        message_type: 'alert',
        priority: 'critical',
        subject: `CRITICAL: Runway estimated at ${runway.toFixed(1)} months`,
        body: `Ledger projects only ${runway.toFixed(1)} months of runway remaining based on current burn rate. All agents should immediately prioritize revenue-generating actions and defer discretionary spending. Risk flags: ${(health?.risk_flags ?? []).join('; ')}.`,
      });
    }

    // ── 12. Build pending decisions for high-authority financial items ─────────
    const pendingDecisions: AgentDecision[] = [];
    for (const rec of (parsed.financial_recommendations ?? [])) {
      if (rec.authority_level === 2 && rec.estimated_impact_usd > 100) {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: rec.title,
          description: rec.description,
          rationale: `Ledger (CFO) identified financial action requiring approval: ${rec.description}`,
          expected_impact: `Estimated impact: $${rec.estimated_impact_usd.toFixed(2)}`,
          estimated_impact_usd: rec.estimated_impact_usd,
          action_type: rec.type,
          action_data: { raw_recommendation: rec },
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 13. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed financial analysis: AI cost $${directCost.toFixed(4)}, budget utilization ${utilPct.toFixed(1)}%, ROI ${roi.toFixed(2)}x, NRR ${nrr.toFixed(1)}%`,
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
      outboundActions,
      agentMessages,
    };
  }
}

export default LedgerAgent;
