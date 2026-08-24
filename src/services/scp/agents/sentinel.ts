// =============================================================================
// FOUNDRY — Sentinel Agent (DevOps)
// Domain: Infrastructure monitoring, deployment health, uptime
// Cadence: 6 hours
// v2: Emits outboundActions for urgent ops items, agentMessages to Atlas/broadcast,
//     hypotheses for deployment experiments
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { measured } from '../../ai/measured.js';

interface SentinelClaudeResponse {
  observations: string[];
  infrastructure_health: {
    deployment_status: 'healthy' | 'degraded' | 'failed' | 'unknown';
    last_deployment_hours_ago: number | null;
    open_incidents: number;
    risk_level: 'green' | 'yellow' | 'red';
  };
  operations_actions: Array<{
    type: 'deploy_block' | 'scale_recommendation' | 'alert_rule' | 'incident_response';
    title: string;
    description: string;
    authority_level: 0 | 1 | 2;
    urgency: 'immediate' | 'planned';
  }>;
  deployment_hypotheses: Array<{
    title: string;
    description: string;
    hypothesis: string;
    success_metric: string;
    success_threshold: number;
    test_duration_days: number;
  }>;
  domain_health_score?: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class SentinelAgent extends BaseAgent {
  getName(): AgentName { return 'sentinel'; }
  getRole(): string { return 'DevOps'; }
  getActivationCadenceHours(): number { return 6; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query infrastructure stressors ─────────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%infra%'
           OR LOWER(stressor_name) LIKE '%deploy%'
           OR LOWER(stressor_name) LIKE '%downtime%'
           OR LOWER(stressor_name) LIKE '%performance%'
           OR LOWER(stressor_name) LIKE '%server%'
           OR LOWER(stressor_name) LIKE '%database%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 2. Query support_volume as incident proxy ─────────────────────────────
    const metricsResult = await db(
      `SELECT support_volume_7d, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [productId]
    );

    // ── 3. Filter integration events for GitHub deployment/PR activity ─────────
    const githubEvents = (context.integrationEvents ?? []).filter(
      e => e.source === 'github' &&
        (e.event_type === 'deployment_status' || e.event_type === 'pr_activity' || e.event_type === 'deploy')
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (stressorResult.rows.length === 0 && metricsResult.rows.length === 0 && githubEvents.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No infrastructure data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Monitoring infrastructure',
      };
      return {
        observations: ['No infrastructure data available yet — Sentinel will monitor operational health as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Sentinel is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    const metricsRow = metricsResult.rows.length > 0
      ? (metricsResult.rows[0] as Record<string, unknown>)
      : null;
    // `support_volume_7d` is nullable and carries no default, so `|| 0` told an
    // agent judging operational health that a company which has never reported
    // support volume had none. See `ai/measured.ts`.
    const supportVolume = measured(metricsRow?.support_volume_7d);

    const githubContext = githubEvents.length > 0
      ? `GitHub deployment/PR events: ${githubEvents.map(e => `[${e.event_type}] ${e.summary}`).join(' | ')}`
      : 'No recent GitHub deployment events';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Sentinel, the VP of Engineering Operations for ${companyName}. You translate infrastructure health into customer impact and business risk.

You do not report server metrics. You report: "Latency on the core workflow increased 340ms last Tuesday between 2-4pm UTC, affecting 847 sessions. Based on our conversion data, this likely cost 12-15 trial-to-paid conversions — approximately $2,400 in foregone monthly revenue. Root cause: the new database query introduced in commit abc123."

You think in terms of reliability as a revenue driver. You connect uptime, performance, and deployment velocity to customer experience and commercial outcomes.

You are proactive about risks that haven't materialized yet: "The current database growth rate will exceed our instance capacity in approximately 38 days at current trajectory. This is not urgent today but requires a decision this week to avoid an emergency next month."

You push back when engineering is moving too fast without adequate testing or when technical decisions are creating operational fragility for the wrong reasons.`
    );

    const userPrompt = `Infrastructure stressors: ${stressorList}.
Support volume (7d, incident proxy): ${supportVolume}${supportVolume === 'unknown' ? ' — never reported, which is not the same as none' : ''}.
${githubContext}.

Assess infrastructure and deployment health. Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "infrastructure_health": {
    "deployment_status": "healthy" | "degraded" | "failed" | "unknown",
    "last_deployment_hours_ago": number | null,
    "open_incidents": number,
    "risk_level": "green" | "yellow" | "red"
  },
  "operations_actions": [
    {
      "type": "deploy_block" | "scale_recommendation" | "alert_rule" | "incident_response",
      "title": "string",
      "description": "string",
      "authority_level": 0 | 1 | 2,
      "urgency": "immediate" | "planned"
    }
  ],
  "deployment_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string",
      "success_threshold": number,
      "test_duration_days": number
    }
  ],
  "domain_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have no
    evidence to score the domain on — an omitted score is recorded as unknown,
    and a guessed one is recorded as a measurement,
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2500, context.productId);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: SentinelClaudeResponse;
    try {
      parsed = parseJSONResponse<SentinelClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Sentinel encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Sentinel experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
      };
    }

    // ── 7. Build decisions for failed/red situations ───────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    const infra = parsed.infrastructure_health;

    if (infra && (infra.deployment_status === 'failed' || infra.risk_level === 'red')) {
      pendingDecisions.push({
        id: nanoid(),
        agent_name: this.getName(),
        title: `CRITICAL: Infrastructure ${infra.deployment_status === 'failed' ? 'deployment failure' : 'red risk level'}`,
        description: `Deployment status: ${infra.deployment_status}, risk: ${infra.risk_level}, open incidents: ${infra.open_incidents}`,
        rationale: `Sentinel (DevOps) detected critical infrastructure condition requiring immediate attention.`,
        expected_impact: 'Resolving this prevents downtime and protects revenue.',
        action_type: 'infra_critical',
        action_data: { infrastructure_health: infra },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      });
    }

    // ── 8. Build outbound actions for immediate operations items ──────────────
    const outboundActions: OutboundActionSignal[] = [];
    for (const action of (parsed.operations_actions ?? [])) {
      if (action.urgency === 'immediate' && action.authority_level <= 1) {
        outboundActions.push({
          action_type: action.type,
          description: action.description,
          parameters: { title: action.title, urgency: action.urgency },
          authority_level: action.authority_level,
        });
      }
    }

    // ── 9. Build agent messages ───────────────────────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];

    if (infra && (infra.deployment_status === 'failed' || infra.risk_level === 'red')) {
      agentMessages.push({
        to_agent: 'atlas',
        message_type: 'alert',
        priority: infra.deployment_status === 'failed' ? 'critical' : 'high',
        subject: `Infrastructure alert: deployment ${infra.deployment_status}, risk ${infra.risk_level}`,
        body: `Sentinel detected infrastructure issues. Deployment status: ${infra.deployment_status}. Open incidents: ${infra.open_incidents}. Atlas should review recent code changes for root cause.`,
      });
    }

    if (infra && infra.open_incidents > 0) {
      agentMessages.push({
        to_agent: 'broadcast',
        message_type: 'alert',
        priority: infra.open_incidents > 2 ? 'critical' : 'high',
        subject: `${infra.open_incidents} open incident(s) detected`,
        body: `Sentinel reports ${infra.open_incidents} open incident(s). Deployment status: ${infra.deployment_status ?? 'unknown'}. Risk level: ${infra.risk_level ?? 'unknown'}. All agents should be aware of potential instability.`,
      });
    }

    // ── 10. Build hypotheses ──────────────────────────────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.deployment_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 11. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed infra analysis: status=${infra?.deployment_status ?? 'unknown'}, `
        + `risk=${infra?.risk_level ?? 'unknown'}, `
        // Zero open incidents is a finding. Not knowing is not that finding.
        + `incidents=${infra?.open_incidents ?? 'unknown'}`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Sentinel completed infrastructure review.',
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
      hypotheses,
    };
  }
}

export default SentinelAgent;
