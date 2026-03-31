// =============================================================================
// FOUNDRY — Forge Agent (Revenue Lead)
// Domain: Revenue optimization, pricing, conversion, expansion
// Cadence: 24 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface ForgeClaudeResponse {
  observations: string[];
  revenue_actions: Array<{
    type: 'pricing' | 'conversion' | 'expansion' | 'retention';
    title: string;
    description: string;
    estimated_impact_usd: number;
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

    // ── 4. Handle no-data case ────────────────────────────────────────────────
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

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];

    // Build MRR trend string from newest to oldest
    const mrrTrend = metricRows.map(row => {
      const date = row.snapshot_date as string;
      const newMrr = (Number(row.new_mrr_cents) || 0) / 100;
      const churned = (Number(row.churned_mrr_cents) || 0) / 100;
      const expansion = (Number(row.expansion_mrr_cents) || 0) / 100;
      const healthRatio = Number(row.mrr_health_ratio) || 0;
      return `${date}: new=$${newMrr.toFixed(2)} churned=$${churned.toFixed(2)} expansion=$${expansion.toFixed(2)} health_ratio=${healthRatio.toFixed(2)}`;
    }).join(' | ');

    // Most recent snapshot
    const latest = metricRows[0];
    const latestNewMrr = (Number(latest.new_mrr_cents) || 0) / 100;
    const latestChurned = (Number(latest.churned_mrr_cents) || 0) / 100;
    const latestExpansion = (Number(latest.expansion_mrr_cents) || 0) / 100;
    const healthRatio = Number(latest.mrr_health_ratio) || 0;

    const lifecycle = lifecycleResult.rows.length > 0
      ? (lifecycleResult.rows[0] as Record<string, unknown>)
      : null;
    const currentPrompt = lifecycle ? ((lifecycle.current_prompt as string) ?? 'unknown') : 'unknown';
    const riskState = lifecycle ? ((lifecycle.risk_state as string) ?? 'unknown') : 'unknown';

    const founderTier = founderResult.rows.length > 0
      ? ((founderResult.rows[0] as Record<string, unknown>).tier as string) ?? 'solo'
      : 'solo';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Forge, the Revenue Lead for ${companyName}. You optimize pricing, conversion, and expansion revenue. Never recommend actions that could damage customer trust for short-term revenue gains.`
    );

    const userPrompt = `MRR trend (last ${metricRows.length} snapshots, newest first): ${mrrTrend}.
Health ratio (churned/new): ${healthRatio.toFixed(2)} (>1.0 means churn exceeds new MRR — critical).
New MRR (latest week): $${latestNewMrr.toFixed(2)}. Churned: $${latestChurned.toFixed(2)}. Expansion: $${latestExpansion.toFixed(2)}.
Lifecycle: ${currentPrompt} | Risk state: ${riskState}.
Founder tier: ${founderTier}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "revenue_actions": [
    {
      "type": "pricing" | "conversion" | "expansion" | "retention",
      "title": "string",
      "description": "string",
      "estimated_impact_usd": number
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
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

    // ── 7. Build decisions ────────────────────────────────────────────────────
    // Pricing/expansion → authority_level=2; conversion → authority_level=1
    const pendingDecisions: AgentDecision[] = [];
    for (const action of (parsed.revenue_actions ?? [])) {
      if (action.type === 'pricing' || action.type === 'expansion') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Forge (Revenue Lead) identified ${action.type} opportunity: ${action.description}`,
          expected_impact: `Estimated revenue impact: $${(action.estimated_impact_usd ?? 0).toFixed(2)}`,
          estimated_impact_usd: action.estimated_impact_usd,
          action_type: `revenue_${action.type}`,
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      } else if (action.type === 'conversion') {
        // Conversion actions also added as decisions for visibility
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Forge (Revenue Lead) identified conversion opportunity: ${action.description}`,
          expected_impact: `Estimated revenue impact: $${(action.estimated_impact_usd ?? 0).toFixed(2)}`,
          estimated_impact_usd: action.estimated_impact_usd,
          action_type: 'revenue_conversion',
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 8. Record analysis action ─────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed revenue analysis: $${latestNewMrr.toFixed(2)} new MRR, $${latestChurned.toFixed(2)} churned, health ratio ${healthRatio.toFixed(2)}`,
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
    };
  }
}

export default ForgeAgent;
