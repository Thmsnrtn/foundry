// =============================================================================
// FOUNDRY — Prism Agent (UX Lead)
// Domain: User experience, onboarding friction, activation patterns
// Cadence: 48 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface PrismClaudeResponse {
  observations: string[];
  ux_issues: Array<{
    area: string;
    impact: 'high' | 'medium' | 'low';
    suggestion: string;
  }>;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class PrismAgent extends BaseAgent {
  getName(): AgentName { return 'prism'; }
  getRole(): string { return 'UX Lead'; }
  getActivationCadenceHours(): number { return 48; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query latest metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT activation_rate, day_30_retention, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query audit_scores for d2 (Experience Coherence) and d4 (Value Legibility) ──
    const auditResult = await db(
      `SELECT d2_score, d4_score, created_at
       FROM audit_scores
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [productId]
    );

    // ── 3. Query beta_intake for feedback ─────────────────────────────────────
    const betaResult = await db(
      `SELECT activation_outcome, positioning_feedback
       FROM beta_intake
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0 && auditResult.rows.length === 0 && betaResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No UX or metric data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting user data',
      };
      return {
        observations: ['No UX data available yet — Prism will analyze activation and experience metrics as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Prism is calibrating — no significant activity to report.',
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

    const audit = auditResult.rows.length > 0
      ? (auditResult.rows[0] as Record<string, unknown>)
      : null;
    const d2 = audit ? Number(audit.d2_score) || 0 : 0;
    const d4 = audit ? Number(audit.d4_score) || 0 : 0;

    const betaRows = betaResult.rows as Record<string, unknown>[];
    const feedbackThemes: string[] = [];
    for (const row of betaRows) {
      if (row.positioning_feedback) feedbackThemes.push(String(row.positioning_feedback).slice(0, 120));
      if (row.activation_outcome) {
        // activation_outcome may be JSON; extract a summary
        let outcome = String(row.activation_outcome);
        try {
          const parsed = JSON.parse(outcome) as Record<string, unknown>;
          outcome = JSON.stringify(parsed).slice(0, 120);
        } catch { /* use raw string */ }
        feedbackThemes.push(`Activation: ${outcome.slice(0, 120)}`);
      }
    }
    const feedbackSummary = feedbackThemes.length > 0
      ? feedbackThemes.slice(0, 5).join(' | ')
      : 'No beta feedback recorded yet';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Prism, the UX Lead agent for ${companyName}. You identify user experience friction, onboarding gaps, and activation failures. Focus on specific, actionable UX improvements.`
    );

    const userPrompt = `Activation rate: ${activationRate.toFixed(1)}%. Day-30 retention: ${day30Retention.toFixed(1)}%.
UX audit scores: Experience Coherence ${d2}/10, Value Legibility ${d4}/10.
Beta feedback themes: ${feedbackSummary}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "ux_issues": [
    {
      "area": "string",
      "impact": "high" | "medium" | "low",
      "suggestion": "string"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: PrismClaudeResponse;
    try {
      parsed = parseJSONResponse<PrismClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Prism encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Prism experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 7. Build decisions for high-impact UX issues ──────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const issue of (parsed.ux_issues ?? [])) {
      if (issue.impact === 'high') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: `UX Fix: ${issue.area}`,
          description: issue.suggestion,
          rationale: `Prism (UX Lead) identified high-impact friction in ${issue.area}: ${issue.suggestion}`,
          expected_impact: 'Expected to improve activation rate and reduce onboarding drop-off.',
          action_type: 'ux_improvement',
          action_data: { raw_action: issue },
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
      description: `Completed UX analysis: activation ${activationRate.toFixed(1)}%, retention ${day30Retention.toFixed(1)}%, ${betaRows.length} beta records`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Prism completed UX review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default PrismAgent;
