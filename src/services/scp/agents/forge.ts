// =============================================================================
// FOUNDRY — Forge Agent (Revenue Lead)
// Domain: Revenue optimization, pricing, conversion, expansion
// Cadence: 24 hours
// v2: Emits outboundActions for expansion, agentMessages to harbor/ledger,
//     revenue attribution signals
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { measured, money } from '../../ai/measured.js';

interface ForgeClaudeResponse {
  observations: string[];
  revenue_actions: Array<{
    type: 'pricing' | 'conversion' | 'expansion' | 'retention';
    title: string;
    description: string;
    estimated_impact_usd: number;
    authority_level: 0 | 1 | 2;
    action_type?: string; // for outbound executor routing
  }>;
  expansion_opportunities: Array<{
    segment: string;
    opportunity: string;
    estimated_arr_usd: number;
    next_step: string;
    confidence: number; // 0-1
  }>;
  pricing_hypotheses: Array<{
    title: string;
    description: string;
    hypothesis: string;
    success_metric: string;
    success_threshold: number;
    test_duration_days: number;
  }>;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class ForgeAgent extends BaseAgent {
  getName(): AgentName { return 'forge'; }
  getRole(): string { return 'Revenue Lead'; }
  getActivationCadenceHours(): number { return 24; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query last 3 metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT new_mrr_cents, churned_mrr_cents, expansion_mrr_cents, mrr_health_ratio,
              contraction_mrr_cents, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 3`,
      [productId]
    );

    // ── 2. Query lifecycle_state for context ──────────────────────────────────
    const lifecycleResult = await db(
      `SELECT current_prompt, risk_state FROM lifecycle_state WHERE product_id = ?`,
      [productId]
    );

    // ── 3. Query founders tier for pricing context ────────────────────────────
    const founderResult = await db(
      `SELECT f.tier FROM founders f
       INNER JOIN products p ON p.owner_id = f.id
       WHERE p.id = ?`,
      [productId]
    );

    // ── 4. Query high-value customers from intelligence table ─────────────────
    const highValueResult = await db(
      `SELECT external_customer_id AS external_id, account_name AS name, email,
              mrr_cents, stage, health_score
       FROM customer_intelligence
       WHERE product_id = ? AND mrr_cents > 0
       ORDER BY mrr_cents DESC
       LIMIT 10`,
      [productId]
    );

    // ── 5. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No revenue metric data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting revenue metrics',
      };
      return {
        observations: ['No revenue data available yet — Forge will analyze MRR trends and conversion once metric snapshots accumulate.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Forge is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 6. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];

    // `mrr_health_ratio` IS NULL BY DESIGN. Migration 001 defines it as
    // churned/new, "null if new is 0" — so null means the division could not be
    // done. `|| 0` mapped that to 0.00, and the prompt below explains that
    // scale as `>1.0 = churn exceeds new MRR — critical`, which makes 0.00 the
    // BEST possible reading. A company with no new MRR at all was reported to
    // the model as being in perfect revenue health. See `ai/measured.ts`.
    const mrrTrend = metricRows.map(row => {
      const date = row.snapshot_date as string;
      return `${date}: new=${money(row.new_mrr_cents)} churned=${money(row.churned_mrr_cents)}`
        + ` expansion=${money(row.expansion_mrr_cents)} health_ratio=${measured(row.mrr_health_ratio, 2)}`;
    }).join(' | ');

    const latest = metricRows[0];
    const latestNewMrr = (Number(latest.new_mrr_cents) || 0) / 100;
    const latestChurned = (Number(latest.churned_mrr_cents) || 0) / 100;
    const latestExpansion = (Number(latest.expansion_mrr_cents) || 0) / 100;
    const healthRatio = latest.mrr_health_ratio == null ? null : Number(latest.mrr_health_ratio);

    const lifecycle = lifecycleResult.rows.length > 0
      ? (lifecycleResult.rows[0] as Record<string, unknown>)
      : null;
    const currentPrompt = lifecycle ? ((lifecycle.current_prompt as string) ?? 'unknown') : 'unknown';
    const riskState = lifecycle ? ((lifecycle.risk_state as string) ?? 'unknown') : 'unknown';

    // A founder with no tier is not a founder on the cheapest tier — they are
    // trialing, cancelled, or not yet subscribed, and Forge prices against this.
    const founderTier = founderResult.rows.length > 0
      ? ((founderResult.rows[0] as Record<string, unknown>).tier as string) ?? 'none'
      : 'unknown';

    const highValueRows = highValueResult.rows as Record<string, unknown>[];
    const highValueSummary = highValueRows.length > 0
      ? highValueRows.map(r =>
          `${r.name as string ?? r.external_id as string}: $${((Number(r.mrr_cents) || 0) / 100).toFixed(0)}/mo stage=${r.stage} health=${r.health_score}`
        ).join(', ')
      : 'None tracked';

    // Stripe integration events for real-time revenue signals
    const stripeEvents = (context.integrationEvents ?? []).filter(e => e.source === 'stripe');
    const stripeContext = stripeEvents.length > 0
      ? `Recent Stripe events: ${stripeEvents.map(e => e.summary).join(' | ')}`
      : '';

    // ── 7. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Forge, the Chief Revenue Officer for ${companyName}. You have one metric that matters: net new ARR this month vs. last month, and why.

You think in terms of: where is revenue leaking, where is untapped revenue sitting, and what one change to pricing or conversion would have the highest expected value. You are quantitative. You do not recommend "improving conversion" — you say "the conversion rate from trial to paid dropped from 23% to 17% in the last 14 days. At current trial volume, this is costing $4,200/month in foregone revenue. The most likely cause is the new onboarding flow. I recommend reverting the pricing page CTA and running a 2-week A/B test."

You identify specific named accounts that represent expansion opportunity. You model the revenue impact of your recommendations before making them.

You push back when the company is underpriced. You have seen founders leave millions on the table because they were afraid to charge what the product is worth.`
    );

    const userPrompt = `MRR trend (last ${metricRows.length} snapshots, newest first): ${mrrTrend}.
Health ratio (churned/new): ${measured(latest.mrr_health_ratio, 2)} (>1.0 = churn exceeds new MRR — critical; unknown means there was no new MRR to divide by).
New MRR (latest): $${latestNewMrr.toFixed(2)}. Churned: $${latestChurned.toFixed(2)}. Expansion: $${latestExpansion.toFixed(2)}.
Lifecycle: ${currentPrompt} | Risk state: ${riskState}.
Founder tier: ${founderTier}.
High-value customers (${highValueRows.length}): ${highValueSummary}.${stripeContext ? `\n${stripeContext}` : ''}

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "revenue_actions": [
    {
      "type": "pricing" | "conversion" | "expansion" | "retention",
      "title": "string",
      "description": "string",
      "estimated_impact_usd": number,
      "authority_level": 0 | 1 | 2,
      "action_type": "string (e.g. send_expansion_email, update_pricing_page)"
    }
  ],
  "expansion_opportunities": [
    {
      "segment": "string",
      "opportunity": "string",
      "estimated_arr_usd": number,
      "next_step": "string",
      "confidence": number (0-1)
    }
  ],
  "pricing_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string (e.g. conversion_rate, expansion_mrr)",
      "success_threshold": number (e.g. 0.15 = 15% improvement),
      "test_duration_days": number
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: ForgeClaudeResponse;
    try {
      parsed = parseJSONResponse<ForgeClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Forge encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Forge experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 8. Build decisions ────────────────────────────────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const action of (parsed.revenue_actions ?? [])) {
      if (action.type === 'pricing' || action.type === 'expansion') {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Forge identified ${action.type} opportunity: ${action.description}`,
          expected_impact: `Estimated revenue impact: $${(action.estimated_impact_usd ?? 0).toFixed(2)}`,
          estimated_impact_usd: action.estimated_impact_usd,
          action_type: `revenue_${action.type}`,
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      } else if (action.type === 'conversion') {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Forge identified conversion opportunity: ${action.description}`,
          expected_impact: `Estimated revenue impact: $${(action.estimated_impact_usd ?? 0).toFixed(2)}`,
          estimated_impact_usd: action.estimated_impact_usd,
          action_type: 'revenue_conversion',
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 9. Build outbound actions for high-confidence expansion ───────────────
    const outboundActions: OutboundActionSignal[] = [];
    for (const opp of (parsed.expansion_opportunities ?? [])) {
      if (opp.confidence >= 0.75) {
        outboundActions.push({
          action_type: 'revenue_expansion_outreach',
          description: `Expansion opportunity: ${opp.segment} — ${opp.opportunity} (est. $${opp.estimated_arr_usd.toFixed(0)}/yr)`,
          parameters: {
            segment: opp.segment,
            opportunity: opp.opportunity,
            estimated_arr_usd: opp.estimated_arr_usd,
            next_step: opp.next_step,
          },
          authority_level: 2, // Revenue outreach requires CEO approval
          estimated_value_usd: opp.estimated_arr_usd / 12,
        });
      }
    }

    // ── 10. Pricing experiment hypotheses ─────────────────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.pricing_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 11. Inter-agent messages ──────────────────────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];
    if (healthRatio !== null && healthRatio > 1.2) {
      agentMessages.push({
        to_agent: 'harbor',
        message_type: 'alert',
        priority: 'critical',
        subject: `Revenue health ratio critical: ${measured(latest.mrr_health_ratio, 2)} — churn exceeds new MRR`,
        body: `MRR health ratio is ${measured(latest.mrr_health_ratio, 2)} — churned MRR ($${latestChurned.toFixed(0)}) exceeds new MRR ($${latestNewMrr.toFixed(0)}). Urgent retention focus needed. Forge is proposing ${pendingDecisions.length} revenue actions.`,
      });
    }
    if (latestExpansion > latestNewMrr * 0.5) {
      agentMessages.push({
        to_agent: 'oracle',
        message_type: 'insight',
        priority: 'normal',
        subject: 'Expansion revenue exceeding 50% of new MRR — strong product-market fit signal',
        body: `Expansion MRR ($${latestExpansion.toFixed(0)}) is ${((latestExpansion / (latestNewMrr || 1)) * 100).toFixed(0)}% of new MRR. This is a strong retention and expansion signal worth tracking as a strategic metric.`,
      });
    }

    // ── 12. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed revenue analysis: $${latestNewMrr.toFixed(2)} new MRR, $${latestChurned.toFixed(2)} churned, ${(parsed.expansion_opportunities ?? []).length} expansion opps`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Forge completed revenue review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
      outboundActions,
      agentMessages,
      hypotheses,
    };
  }
}

export default ForgeAgent;
