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
  company_health_score?: number;
  domain_health_score?: number;
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
      // `company_okrs.status` is on_track / at_risk / off_track / completed /
      // cancelled — there is no 'active'. Compass's view of the company's
      // objectives has always been empty, and an agent with no OKRs in context
      // reasons as though the company has none.
      //
      // FIXING THE STATUS FILTER DID NOT MAKE IT NON-EMPTY, and the reason is
      // larger: `createOKR` has no caller anywhere in `src/`, so no company can
      // have an OKR at all. This query is correct and will return nothing until
      // something creates one. The founder-facing page said "Agents will create
      // objectives as your strategy evolves"; nothing does, and it no longer
      // says so.
      // Ordered, so the five an agent sees are the five most at risk rather
      // than five arbitrary ones. (The table has no writer — see above — so
      // this returns nothing today; the order is here for when it does.)
      `SELECT objective_text AS objective, status FROM company_okrs
        WHERE product_id=? AND status IN ('on_track','at_risk','off_track')
        ORDER BY CASE status WHEN 'off_track' THEN 1 WHEN 'at_risk' THEN 2 ELSE 3 END,
                 created_at ASC
        LIMIT 5`,
      [productId]
    );

    // ── 5. Query recent strategic decisions log ───────────────────────────────
    const decisionsLogResult = await db(
      `SELECT decision_title AS title, decision_description AS decision_made,
              retrospective_score AS outcome_rating
         FROM strategic_decisions_log WHERE product_id=? ORDER BY made_at DESC LIMIT 3`,
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
      `You are Compass, the strategic Chief of Staff for ${companyName}. You hold the full picture when every other agent is focused on their domain.

Your highest value is: identifying when the company is pursuing a strategy that is no longer supported by the evidence, and saying so clearly. You have seen founders persist with the wrong ICP for 6 months after the data was telling them to pivot. You are the one who names that.

You synthesize cross-functional signals into a single strategic verdict: is the company moving toward or away from product-market fit? Are the OKRs still pointing at the right north star? Is the board narrative still credible given current metrics?

You do not validate. You challenge. When a strategic assumption has not been tested in 60+ days, you flag it. When the company is doing 4 things and should be doing 1, you name the 1.

You think in terms of: what decision does the CEO need to make this week that only they can make, and what information do they need to make it well?`
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
  "company_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have
    no evidence to score the company on,
  "domain_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have no
    evidence to score the domain on — an omitted score is recorded as unknown,
    and a guessed one is recorded as a measurement,
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
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
      description: `Completed strategic analysis: ${currentPrompt}, ${decisionCount} pending decisions, `
        + `health=${parsed.company_health_score ?? 'not scored'}`,
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
      // No `?? 50`. The type says `domainHealthScore?: number` — "if provided" —
      // and a model that did not return a score has not scored the domain. 50 is
      // the middle of the bar the dashboard draws, so an unscored agent used to
      // render as exactly average, in amber, next to agents that were measured.
      // Migration-free fix: the column is already nullable and run-recorder
      // already writes null.
      domainHealthScore: parsed.company_health_score ?? parsed.domain_health_score,
      outboundActions,
      agentMessages,
      hypotheses,
    };
  }
}

export default CompassAgent;
