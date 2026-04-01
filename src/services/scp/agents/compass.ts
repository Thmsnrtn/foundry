// =============================================================================
// FOUNDRY — Compass Agent (CEO)
// Domain: Strategic direction, company health, big-picture decisions
// Cadence: 48 hours
// v2: Emits hypotheses for strategic bets, agentMessages (directives), outboundActions
//     for board-level proposals
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface CompassClaudeResponse {
  observations: string[];
  recommendations: Array<{
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  strategic_hypotheses: Array<{
    title: string;
    description: string;
    hypothesis: string;
    success_metric: string;
    success_threshold: number;
    test_duration_days: number;
  }>;
  agent_directives: Array<{
    to_agent: string;
    directive: string;
    priority: 'high' | 'normal';
  }>;
  company_health_score: number;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class CompassAgent extends BaseAgent {
  getName(): AgentName { return 'compass'; }
  getRole(): string { return 'CEO'; }
  getActivationCadenceHours(): number { return 48; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query lifecycle_state ──────────────────────────────────────────────
    const lifecycleResult = await db(
      `SELECT * FROM lifecycle_state WHERE product_id = ?`,
      [productId]
    );

    // ── 2. Query pending decisions ────────────────────────────────────────────
    const decisionsResult = await db(
      `SELECT id, category, what, why_now, created_at
       FROM decisions
       WHERE product_id = ? AND status = 'pending'
       ORDER BY created_at ASC`,
      [productId]
    );

    // ── 3. Query recent founding story artifacts ───────────────────────────────
    const artifactsResult = await db(
      `SELECT phase, title, created_at
       FROM founding_story_artifacts
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 5`,
      [productId]
    );

    // ── 4. Query active company OKRs ──────────────────────────────────────────
    const okrResult = await db(
      `SELECT objective, status FROM company_okrs WHERE product_id=? AND status='active' LIMIT 5`,
      [productId]
    );

    // ── 5. Query recent strategic decisions log ───────────────────────────────
    const decisionsLogResult = await db(
      `SELECT title, decision_made, outcome_rating FROM strategic_decisions_log WHERE product_id=? ORDER BY created_at DESC LIMIT 3`,
      [productId]
    );

    // ── 6. Handle no-data case ────────────────────────────────────────────────
    if (lifecycleResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No lifecycle data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting lifecycle initialization',
      };
      return {
        observations: ['No lifecycle data available yet — Compass will track progress once the product lifecycle is initialized.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Compass is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 7. Build prompt data ──────────────────────────────────────────────────
    const lifecycle = lifecycleResult.rows[0] as Record<string, unknown>;
    const currentPrompt = (lifecycle.current_prompt as string) ?? 'unknown';
    const riskState = (lifecycle.risk_state as string) ?? 'unknown';

    const promptMatch = currentPrompt.match(/(\d+(?:\.\d+)?)/);
    const promptN = promptMatch ? promptMatch[1] : '?';

    const decisionRows = decisionsResult.rows as Record<string, unknown>[];
    const decisionCount = decisionRows.length;

    let oldestDecisionAgeDays = 0;
    if (decisionRows.length > 0) {
      const oldestCreated = decisionRows[0].created_at as string;
      const oldestMs = new Date(oldestCreated).getTime();
      oldestDecisionAgeDays = Math.floor((Date.now() - oldestMs) / (1000 * 60 * 60 * 24));
    }

    const artifactRows = artifactsResult.rows as Record<string, unknown>[];
    const milestoneList = artifactRows.length > 0
      ? artifactRows.map(a => `[${a.phase as string}] ${a.title as string}`).join(', ')
      : 'No recent milestones recorded';

    const promptStatuses: string[] = [];
    for (let i = 1; i <= 9; i++) {
      const key = `prompt_${i}_status`;
      const val = lifecycle[key] as string | undefined;
      if (val && val !== 'not_started' && val !== 'dormant') {
        promptStatuses.push(`Prompt ${i}: ${val}`);
      }
    }

    const okrRows = okrResult.rows as Record<string, unknown>[];
    const okrSummary = okrRows.length > 0
      ? okrRows.map(o => `${o.objective as string} [${o.status as string}]`).join('; ')
      : 'No active OKRs';

    const decisionLogRows = decisionsLogResult.rows as Record<string, unknown>[];
    const decisionLogSummary = decisionLogRows.length > 0
      ? decisionLogRows.map(d => `"${d.title as string}" — decided: ${d.decision_made as string}, outcome: ${d.outcome_rating as string ?? 'TBD'}`).join('; ')
      : 'No recent strategic decisions';

    // ── 8. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Compass, the CEO strategic agent for ${companyName}. You assess company-wide health, set strategic direction, and coordinate other agents. Think big-picture: OKRs, strategic bets, board-level decisions, and cross-functional priorities.`
    );

    const userPrompt = `Lifecycle state: ${currentPrompt} (prompt ${promptN}/9). Risk state: ${riskState}.
Prompt progress: ${promptStatuses.length > 0 ? promptStatuses.join(', ') : 'all prompts at initial state'}.
Pending decisions: ${decisionCount}${decisionCount > 0 ? ` (oldest: ${oldestDecisionAgeDays} days)` : ''}.
Recent milestones: ${milestoneList}.
Active OKRs: ${okrSummary}.
Recent strategic decisions: ${decisionLogSummary}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "recommendations": [
    {
      "title": "string",
      "description": "string",
      "priority": "high" | "medium" | "low"
    }
  ],
  "strategic_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string",
      "success_threshold": number,
      "test_duration_days": number
    }
  ],
  "agent_directives": [
    {
      "to_agent": "string (agent name, e.g. 'beacon', 'forge', 'harbor')",
      "directive": "string (what Compass needs that agent to focus on)",
      "priority": "high" | "normal"
    }
  ],
  "company_health_score": number (0-100),
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: CompassClaudeResponse;
    try {
      parsed = parseJSONResponse<CompassClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Compass encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Compass experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 9. Build decisions for high-priority recommendations ──────────────────
    const pendingDecisions: AgentDecision[] = [];

    for (const rec of (parsed.recommendations ?? [])) {
      if (rec.priority === 'high') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: rec.title,
          description: rec.description,
          rationale: `Compass (CEO) identified: ${rec.description}`,
          expected_impact: 'Unblocks product lifecycle progression and reduces roadmap risk.',
          action_type: 'roadmap_action',
          action_data: { raw_action: rec },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 10. Build outbound actions for board-level strategic proposals ─────────
    const outboundActions: OutboundActionSignal[] = [];
    for (const rec of (parsed.recommendations ?? [])) {
      if (rec.priority === 'high') {
        outboundActions.push({
          action_type: 'strategic_proposal',
          description: rec.description,
          parameters: {
            title: rec.title,
            priority: rec.priority,
          },
          authority_level: 2, // Board-level: requires human approval
        });
      }
    }

    // ── 11. Build agent messages from directives ──────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];
    for (const directive of (parsed.agent_directives ?? [])) {
      agentMessages.push({
        to_agent: directive.to_agent,
        message_type: 'request',
        priority: directive.priority === 'high' ? 'high' : 'normal',
        subject: `Strategic directive from Compass`,
        body: directive.directive,
      });
    }

    // ── 12. Build hypotheses from strategic_hypotheses ────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.strategic_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 13. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed strategic analysis: ${currentPrompt}, ${decisionCount} pending decisions, health=${parsed.company_health_score ?? 50}`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Compass completed strategic review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.company_health_score ?? parsed.domain_health_score ?? 50,
      outboundActions,
      agentMessages,
      hypotheses,
    };
  }
}

export default CompassAgent;
