// =============================================================================
// FOUNDRY — Harbor Agent (Customer Success)
// Domain: Customer success, retention, health monitoring
// Cadence: 12 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface HarborClaudeResponse {
  observations: string[];
  retention_actions: Array<{
    type: 'outreach' | 'intervention' | 'product_feedback' | 'health_check';
    title: string;
    description: string;
    target_segment: string;
    estimated_reactivation_pct: number;
  }>;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class HarborAgent extends BaseAgent {
  getName(): AgentName { return 'harbor'; }
  getRole(): string { return 'Customer Success'; }
  getActivationCadenceHours(): number { return 12; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query latest metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT activation_rate, day_30_retention, churn_rate, nps_score, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query last 3 cohorts ───────────────────────────────────────────────
    const cohortsResult = await db(
      `SELECT acquisition_period, acquisition_channel, founder_count, activated_count,
              retained_day_7, retained_day_30, retained_day_60, churned_count
       FROM cohorts
       WHERE product_id = ?
       ORDER BY acquisition_period DESC
       LIMIT 3`,
      [productId]
    );

    // ── 3. Query retention/churn stressors ────────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%retention%'
           OR LOWER(stressor_name) LIKE '%churn%'
           OR LOWER(stressor_name) LIKE '%customer%'
           OR LOWER(stressor_name) LIKE '%support%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0 && cohortsResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No customer success data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting customer metrics',
      };
      return {
        observations: ['No customer success data available yet — Harbor will monitor retention and health metrics as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Harbor is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const metrics = metricsResult.rows.length > 0
      ? (metricsResult.rows[0] as Record<string, unknown>)
      : null;
    const activationRate = metrics ? (Number(metrics.activation_rate) || 0) * 100 : 0;
    const day30Retention = metrics ? (Number(metrics.day_30_retention) || 0) * 100 : 0;
    const churnRate = metrics ? (Number(metrics.churn_rate) || 0) * 100 : 0;
    const nps = metrics ? Number(metrics.nps_score) || 0 : 0;

    // Build cohort retention trend
    const cohortRows = cohortsResult.rows as Record<string, unknown>[];
    let cohortTrend = 'No cohort data';
    if (cohortRows.length > 0) {
      cohortTrend = cohortRows.map(c => {
        const total = Number(c.founder_count) || 1;
        const activated = Number(c.activated_count) || 0;
        const retDay30 = Number(c.retained_day_30) || 0;
        const actPct = ((activated / total) * 100).toFixed(1);
        const retPct = ((retDay30 / total) * 100).toFixed(1);
        return `${c.acquisition_period as string} (${c.acquisition_channel as string ?? 'unknown'}): activation=${actPct}%, day30_retention=${retPct}%`;
      }).join(' | ');
    }

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Harbor, the Customer Success agent for ${companyName}. You monitor customer health, identify at-risk users, and drive retention. Always prioritize customer outcomes over short-term metrics.`
    );

    const userPrompt = `Activation rate: ${activationRate.toFixed(1)}%. Day-30 retention: ${day30Retention.toFixed(1)}%. Churn rate: ${churnRate.toFixed(1)}%. NPS: ${nps.toFixed(1)}.
Cohort retention trend: ${cohortTrend}.
Retention stressors: ${stressorList}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "retention_actions": [
    {
      "type": "outreach" | "intervention" | "product_feedback" | "health_check",
      "title": "string",
      "description": "string",
      "target_segment": "string",
      "estimated_reactivation_pct": number
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: HarborClaudeResponse;
    try {
      parsed = parseJSONResponse<HarborClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Harbor encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Harbor experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 7. Build decisions for outreach campaigns (authority_level=1) ─────────
    const pendingDecisions: AgentDecision[] = [];
    for (const action of (parsed.retention_actions ?? [])) {
      if (action.type === 'outreach') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Harbor (Customer Success) identified outreach opportunity for ${action.target_segment}: ${action.description}`,
          expected_impact: `Estimated ${action.estimated_reactivation_pct.toFixed(1)}% reactivation rate for target segment.`,
          action_type: 'cs_outreach',
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
      description: `Completed CS analysis: activation ${activationRate.toFixed(1)}%, churn ${churnRate.toFixed(1)}%, NPS ${nps.toFixed(1)}`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Harbor completed customer success review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default HarborAgent;
