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
  domain_health_score?: number;
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
      // `estimated_value_usd` is not a column on `outbound_actions` — the
      // money it records is `cost_usd`, what the action COST, not what it was
      // guessed to be worth. Ledger's whole reason for reading this table is
      // spend, so the sum is spend, and it is named for what it is.
      `SELECT agent_name, COUNT(*) as executed_count,
              SUM(COALESCE(cost_usd, 0)) as total_cost_usd
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
    // These three are COMPANY-REPORTED and nullable. `|| 0` told the financial
    // agent that a month with no churn figure had churned exactly nothing, and
    // that a month with no new-business figure won exactly nothing. A month
    // nobody reported and a month that genuinely stood still looked identical to
    // the agent whose whole job is reading the shape of the revenue.
    //
    // Foundry's OWN ledgers below are different and are left as they are: an
    // absent `ai_cost_trailing_30d_usd` really does mean no spend was recorded,
    // because Foundry is the thing that records it.
    const { money } = await import('../../ai/measured.js');
    const metricRows = metricsResult.rows as Record<string, unknown>[];
    const mrrSeries = metricRows.map(row => {
      const date = row.snapshot_date as string;
      return `${date}: new=${money(row.new_mrr_cents)} `
        + `churned=${money(row.churned_mrr_cents)} `
        + `expansion=${money(row.expansion_mrr_cents)}`;
    }).join(' | ');

    const productRow = productResult.rows.length > 0
      ? (productResult.rows[0] as Record<string, unknown>)
      : null;
    const aiCostTotal = productRow ? Number(productRow.ai_cost_trailing_30d_usd) || 0 : 0;
    // The founder's operating budget. `|| 50` invented a $50/month budget for a
    // company that had not set one — and then `budgetUtilization` divided the
    // real AI spend by that invented number and reported the percentage to the
    // agent that judges whether the spend is justified. `|| 50` also swallowed a
    // genuine budget of 0.
    const budget = productRow?.operating_budget_monthly_usd == null
      ? null : Number(productRow.operating_budget_monthly_usd);
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
          `${r.agent_name as string}: ${r.executed_count as number} actions, cost $${(Number(r.total_cost_usd) || 0).toFixed(2)}`
        ).join(', ')
      : 'No executed actions in 30d';

    // A COMPANY THAT HAS SPENT NOTHING HAS NO ROI, NOT AN ROI OF ZERO. The
    // fallback reported the worst possible return for the state of having spent
    // nothing yet, to an agent whose job is judging whether the spend is worth
    // it. See `ai/measured.ts`.
    const roi = aiCostTotal > 0 ? attributedRevenue / aiCostTotal : null;
    const budgetUtilization = budget !== null && budget > 0
      ? (aiCostTotal / budget) * 100
      : null;

    // Stripe integration events
    const stripeEvents = (context.integrationEvents ?? []).filter(e => e.source === 'stripe');
    const stripeContext = stripeEvents.length > 0
      ? `Stripe signals: ${stripeEvents.map(e => `[${e.event_type}] ${e.summary}`).join(' | ')}`
      : 'No Stripe events';

    // ── 8. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Ledger, the Chief Financial Officer for ${companyName}. You have one primary job: ensuring the company does not run out of money before it achieves the next value inflection point.

You track: runway with precision (not "12 months" but "14.2 months at current burn assuming no revenue change, 8.7 months if churn continues at current rate"), unit economics with brutality (LTV:CAC below 3:1 is a growth machine that destroys value), and burn composition with specificity (which line items are growing faster than revenue, and why).

You are direct about burn rate relative to milestones. You say: "At current burn, we have $847K of runway. The next meaningful fundraising milestone (Series A standard: $50K MRR) requires approximately 4 months of growth at current rate. This gives us a 3-month cushion — which is insufficient for a typical 6-month raise process. We are 3 months behind on our fundraising timeline."

You flag when the company is spending on the wrong things. You quantify the ROI of every major initiative and push back when it doesn't pencil out.

You track AI/tool costs as a percentage of revenue — costs that are growing faster than revenue are a red flag.`
    );

    const userPrompt = `MRR last ${metricRows.length} periods (newest first): ${mrrSeries || 'No MRR data'}.
Total AI cost (30d): $${directCost.toFixed(4)}. Budget: ${budget === null ? 'not set by the founder' : `$${budget.toFixed(2)}/month`}. Utilization: ${budgetUtilization === null ? 'unknown' : `${budgetUtilization.toFixed(1)}%`}.
Attributed revenue (30d): $${attributedRevenue.toFixed(2)}. Calculated ROI: ${roi === null ? 'not computable — nothing has been spent yet' : `${roi.toFixed(2)}x`}.
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
  "domain_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have no
    evidence to score the domain on — an omitted score is recorded as unknown,
    and a guessed one is recorded as a measurement,
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
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
            budget_utilization_pct: health?.budget_utilization_pct ?? budgetUtilization ?? 0,
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
    const utilText = utilPct === null ? 'unknown' : `${utilPct.toFixed(1)}%`;
    if (utilPct !== null && utilPct > 80) {
      agentMessages.push({
        to_agent: 'broadcast',
        message_type: 'alert',
        priority: utilPct > 95 ? 'critical' : 'high',
        subject: `Budget utilization at ${utilText} — AI cost review needed`,
        // `utilPct` is only non-null when a budget was set, so this branch
        // cannot be reached without one — but the value is narrowed explicitly
        // rather than asserted, because that coupling is not visible here.
        body: `Ledger reports budget utilization at ${utilText} for the month. `
          + `AI costs: $${directCost.toFixed(4)}. `
          + `Budget cap: ${budget === null ? 'not set' : `$${budget.toFixed(2)}`}. `
          + `All agents should minimize unnecessary Claude calls until next billing cycle.`,
      });
    }

    // Alert Forge when NRR < 90%
    // 100% NET REVENUE RETENTION IS A HEALTHY COMPANY. It was what a model
    // declining to estimate produced, and it went into the run description as
    // a figure. Null raises nothing and is reported as nothing.
    const nrr = health?.nrr_estimate ?? null;
    if (nrr !== null && nrr < 90) {
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
      description: `Completed financial analysis: AI cost $${directCost.toFixed(4)}, budget utilization ${utilText}, ROI ${roi === null ? 'not computable' : `${roi.toFixed(2)}x`}, NRR ${nrr === null ? 'not estimated' : `${nrr.toFixed(1)}%`}`,
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
      // No `?? 50`. The type says `domainHealthScore?: number` — "if provided" —
      // and a model that did not return a score has not scored the domain. 50 is
      // the middle of the bar the dashboard draws, so an unscored agent used to
      // render as exactly average, in amber, next to agents that were measured.
      // Migration-free fix: the column is already nullable and run-recorder
      // already writes null.
      domainHealthScore: parsed.domain_health_score,
      outboundActions,
      agentMessages,
    };
  }
}

export default LedgerAgent;
