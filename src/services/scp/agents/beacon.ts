// =============================================================================
// FOUNDRY — Beacon Agent (CMO)
// Domain: Marketing, acquisition, brand, positioning experiments
// Cadence: 24 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface BeaconClaudeResponse {
  observations: string[];
  marketing_actions: Array<{
    type: 'content' | 'positioning' | 'channel' | 'experiment';
    title: string;
    description: string;
    estimated_impact: string;
  }>;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class BeaconAgent extends BaseAgent {
  getName(): AgentName { return 'beacon'; }
  getRole(): string { return 'CMO'; }
  getActivationCadenceHours(): number { return 24; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query latest metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT signups_7d, active_users, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query product_dna ──────────────────────────────────────────────────
    const dnaResult = await db(
      `SELECT icp_description, positioning_statement, what_we_are_not, voice_principles
       FROM product_dna
       WHERE product_id = ?`,
      [productId]
    );

    // ── 3. Query top 5 competitors ────────────────────────────────────────────
    const competitorsResult = await db(
      `SELECT name, positioning, primary_icp
       FROM competitors
       WHERE product_id = ? AND monitoring_active = 1
       ORDER BY added_at ASC
       LIMIT 5`,
      [productId]
    );

    // ── 4. Query unreviewed competitive signals ────────────────────────────────
    const signalsResult = await db(
      `SELECT competitor_name, signal_type, signal_summary, significance, detected_at
       FROM competitive_signals
       WHERE product_id = ? AND reviewed = 0
       ORDER BY detected_at DESC
       LIMIT 10`,
      [productId]
    );

    // ── 5. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0 && dnaResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No marketing or product DNA data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting product DNA and metrics',
      };
      return {
        observations: ['No marketing data available yet — Beacon will analyze acquisition and positioning once product DNA and metrics are populated.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Beacon is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 6. Build prompt data ──────────────────────────────────────────────────
    const metrics = metricsResult.rows.length > 0
      ? (metricsResult.rows[0] as Record<string, unknown>)
      : null;
    const signups = metrics ? Number(metrics.signups_7d) || 0 : 0;
    const activeUsers = metrics ? Number(metrics.active_users) || 0 : 0;

    const dna = dnaResult.rows.length > 0
      ? (dnaResult.rows[0] as Record<string, unknown>)
      : null;
    const icp = dna ? ((dna.icp_description as string) ?? 'Not defined') : 'Not defined';
    const positioning = dna ? ((dna.positioning_statement as string) ?? 'Not defined') : 'Not defined';
    const whatWeAreNot = dna ? ((dna.what_we_are_not as string) ?? '') : '';
    const voicePrinciples = dna ? ((dna.voice_principles as string) ?? '') : '';

    const competitorRows = competitorsResult.rows as Record<string, unknown>[];
    const competitorNames = competitorRows.length > 0
      ? competitorRows.map(c => `${c.name as string} (${c.positioning as string ?? 'unknown positioning'})`).join(', ')
      : 'No competitors tracked yet';

    const signalRows = signalsResult.rows as Record<string, unknown>[];
    const signalCount = signalRows.length;
    const recentSignals = signalRows.length > 0
      ? signalRows.slice(0, 3).map(s =>
          `${s.competitor_name as string}: ${s.signal_type as string} — ${s.signal_summary as string}`
        ).join(' | ')
      : '';

    // ── 7. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Beacon, the CMO agent for ${companyName}. You drive acquisition, refine positioning, and experiment with marketing channels. Prioritize high-signal, low-cost experiments over large campaigns.`
    );

    const userPrompt = `New signups (7d): ${signups}. Active users: ${activeUsers}.
ICP: ${icp}.
Positioning: ${positioning}.
What we are not: ${whatWeAreNot || 'Not specified'}.
Voice principles: ${voicePrinciples || 'Not specified'}.
Key competitors: ${competitorNames}.
Unreviewed competitive signals: ${signalCount}.${recentSignals ? ` Latest: ${recentSignals}` : ''}

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "marketing_actions": [
    {
      "type": "content" | "positioning" | "channel" | "experiment",
      "title": "string",
      "description": "string",
      "estimated_impact": "string"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: BeaconClaudeResponse;
    try {
      parsed = parseJSONResponse<BeaconClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Beacon encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Beacon experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 8. Build decisions for experiments ───────────────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const action of (parsed.marketing_actions ?? [])) {
      if (action.type === 'experiment') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Beacon (CMO) proposed marketing experiment: ${action.description}`,
          expected_impact: action.estimated_impact,
          action_type: 'marketing_experiment',
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 9. Record analysis action ─────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed marketing analysis: ${signups} signups (7d), ${signalCount} unreviewed signals`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Beacon completed marketing review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default BeaconAgent;
