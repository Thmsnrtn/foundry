// =============================================================================
// FOUNDRY — Atlas Agent (CTO)
// Domain: Code quality, architecture, technical debt, security
// Cadence: 24 hours
// v2: Emits outboundActions for immediate proposals, agentMessages to Crucible/Sentinel,
//     hypotheses for technical experiments
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface AtlasClaudeResponse {
  observations: string[];
  technical_health_assessment: {
    code_quality_score: number;
    security_risk_level: 'low' | 'medium' | 'high' | 'critical';
    debt_trend: 'improving' | 'stable' | 'worsening';
    key_risks: string[];
  };
  architecture_proposals: Array<{
    title: string;
    description: string;
    priority: 'immediate' | 'this_sprint' | 'this_quarter';
    estimated_effort: string;
    authority_level: 0 | 1 | 2;
  }>;
  technical_hypotheses: Array<{
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

export class AtlasAgent extends BaseAgent {
  getName(): AgentName { return 'atlas'; }
  getRole(): string { return 'CTO'; }
  getActivationCadenceHours(): number { return 24; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query metric_snapshots for incident proxy ───────────────────────────
    const metricsResult = await db(
      `SELECT support_volume_7d, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query technical stressors ─────────────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%tech%'
           OR LOWER(stressor_name) LIKE '%security%'
           OR LOWER(stressor_name) LIKE '%debt%'
           OR LOWER(stressor_name) LIKE '%architecture%'
           OR LOWER(stressor_name) LIKE '%code%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 3. Query recent Atlas sessions for trend ──────────────────────────────
    const sessionResult = await db(
      `SELECT domain_health_score, completed_at
       FROM agent_sessions
       WHERE product_id = ? AND agent_name = 'atlas'
       ORDER BY completed_at DESC
       LIMIT 3`,
      [productId]
    );

    // ── 4. Query recent Crucible findings ─────────────────────────────────────
    const crucibleResult = await db(
      `SELECT briefing_contribution, completed_at
       FROM agent_sessions
       WHERE product_id = ? AND agent_name = 'crucible'
         AND completed_at > datetime('now', '-24 hours')
       ORDER BY completed_at DESC
       LIMIT 1`,
      [productId]
    );

    // ── 5. Handle no-data case ────────────────────────────────────────────────
    const githubEvents = (context.integrationEvents ?? []).filter(e => e.source === 'github');
    if (
      metricsResult.rows.length === 0 &&
      stressorResult.rows.length === 0 &&
      githubEvents.length === 0
    ) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No technical data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting technical data',
      };
      return {
        observations: ['No technical data available yet — Atlas will assess code quality and architecture as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Atlas is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 6. Build prompt data ──────────────────────────────────────────────────
    const metricsRow = metricsResult.rows.length > 0
      ? (metricsResult.rows[0] as Record<string, unknown>)
      : null;
    const supportVolume = metricsRow ? Number(metricsRow.support_volume_7d) || 0 : 0;

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    const sessionRows = sessionResult.rows as Record<string, unknown>[];
    const healthTrend = sessionRows.length > 0
      ? sessionRows.map(r => `${r.completed_at as string}: score=${r.domain_health_score as number}`).join(' → ')
      : 'No previous sessions';

    const crucibleRow = crucibleResult.rows.length > 0
      ? (crucibleResult.rows[0] as Record<string, unknown>)
      : null;
    const crucibleFindings = crucibleRow
      ? `Crucible (QA) recent findings: ${crucibleRow.briefing_contribution as string}`
      : 'No recent Crucible findings';

    const githubContext = githubEvents.length > 0
      ? `GitHub activity: ${githubEvents.map(e => `[${e.event_type}] ${e.summary}`).join(' | ')}`
      : 'No GitHub integration events';

    // ── 7. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Atlas, the CTO agent for ${companyName}. You assess code quality, architecture health, and technical risk. Be precise and technical. Prioritize security and architectural integrity.`
    );

    const userPrompt = `Support volume (7d, incident proxy): ${supportVolume}.
Active technical stressors: ${stressorList}.
Historical domain health trend: ${healthTrend}.
${crucibleFindings}.
${githubContext}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "technical_health_assessment": {
    "code_quality_score": number (0-100),
    "security_risk_level": "low" | "medium" | "high" | "critical",
    "debt_trend": "improving" | "stable" | "worsening",
    "key_risks": ["string", ...]
  },
  "architecture_proposals": [
    {
      "title": "string",
      "description": "string",
      "priority": "immediate" | "this_sprint" | "this_quarter",
      "estimated_effort": "string",
      "authority_level": 0 | 1 | 2
    }
  ],
  "technical_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string",
      "success_threshold": number,
      "test_duration_days": number
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: AtlasClaudeResponse;
    try {
      parsed = parseJSONResponse<AtlasClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Atlas encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Atlas experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 8. Build decisions for immediate proposals ─────────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const proposal of (parsed.architecture_proposals ?? [])) {
      if (proposal.priority === 'immediate' && proposal.authority_level === 2) {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: proposal.title,
          description: proposal.description,
          rationale: `Atlas (CTO) identified immediate architectural concern: ${proposal.description}`,
          expected_impact: `Effort: ${proposal.estimated_effort}`,
          action_type: 'architecture_proposal',
          action_data: { raw_proposal: proposal },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 9. Build outbound actions for immediate, low-authority proposals ───────
    const outboundActions: OutboundActionSignal[] = [];
    for (const proposal of (parsed.architecture_proposals ?? [])) {
      if (proposal.priority === 'immediate' && proposal.authority_level <= 1) {
        outboundActions.push({
          action_type: 'architecture_proposal',
          description: proposal.description,
          parameters: {
            title: proposal.title,
            estimated_effort: proposal.estimated_effort,
            priority: proposal.priority,
          },
          authority_level: proposal.authority_level,
        });
      }
    }

    // ── 10. Build agent messages ──────────────────────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];
    const assessment = parsed.technical_health_assessment;

    if (assessment && (assessment.security_risk_level === 'high' || assessment.security_risk_level === 'critical')) {
      agentMessages.push({
        to_agent: 'crucible',
        message_type: 'alert',
        priority: assessment.security_risk_level === 'critical' ? 'critical' : 'high',
        subject: `Security risk level: ${assessment.security_risk_level} — QA coverage needed`,
        body: `Atlas detected ${assessment.security_risk_level} security risk. Key risks: ${(assessment.key_risks ?? []).join('; ')}. Crucible should verify test coverage for affected areas.`,
      });
    }

    const deploymentEvents = githubEvents.filter(e =>
      e.event_type === 'deployment_status' || e.event_type === 'deploy'
    );
    if (deploymentEvents.length > 0) {
      agentMessages.push({
        to_agent: 'sentinel',
        message_type: 'update',
        priority: 'normal',
        subject: 'GitHub deployment activity detected',
        body: `Atlas observed deployment events: ${deploymentEvents.map(e => e.summary).join(' | ')}. Sentinel should verify infrastructure stability post-deploy.`,
      });
    }

    // ── 11. Build hypotheses ──────────────────────────────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.technical_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 12. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed technical analysis: quality=${assessment?.code_quality_score ?? 0}/100, security=${assessment?.security_risk_level ?? 'unknown'}, ${stressorRows.length} stressors`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Atlas completed technical review.',
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

export default AtlasAgent;
