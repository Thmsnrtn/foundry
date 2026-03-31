// =============================================================================
// FOUNDRY — Atlas Agent (CTO)
// Domain: Code quality, architecture, technical debt, security
// Cadence: 24 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { createRemediation } from '../remediation.js';

interface AtlasClaudeResponse {
  observations: string[];
  actions_proposed: Array<{
    title: string;
    description: string;
    expected_impact: string;
    urgency: 'high' | 'medium' | 'low';
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

    // ── 1. Query latest audit_scores ──────────────────────────────────────────
    const auditResult = await db(
      `SELECT * FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
      [productId]
    );

    // ── 2. Query open remediation PRs ─────────────────────────────────────────
    const prResult = await db(
      `SELECT id, blocking_issue_summary, blocking_issue_dimension, status, created_at
       FROM remediation_prs WHERE product_id = ? AND status = 'pr_open'
       ORDER BY created_at DESC`,
      [productId]
    );

    // ── 3. Query tech/security/debt stressors ─────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%tech%'
           OR LOWER(stressor_name) LIKE '%security%'
           OR LOWER(stressor_name) LIKE '%debt%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (auditResult.rows.length === 0 && prResult.rows.length === 0 && stressorResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No audit or technical data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting first audit run',
      };
      return {
        observations: ['No technical audit data available yet — Atlas will assess on next cycle after audit data accumulates.'],
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

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const audit = auditResult.rows.length > 0
      ? (auditResult.rows[0] as Record<string, unknown>)
      : null;

    const composite = audit ? Number(audit.composite) || 0 : 0;
    const d1 = audit ? Number(audit.d1_score) || 0 : 0;
    const d2 = audit ? Number(audit.d2_score) || 0 : 0;
    const d3 = audit ? Number(audit.d3_score) || 0 : 0;
    const d4 = audit ? Number(audit.d4_score) || 0 : 0;
    const d5 = audit ? Number(audit.d5_score) || 0 : 0;
    const d6 = audit ? Number(audit.d6_score) || 0 : 0;
    const d7 = audit ? Number(audit.d7_score) || 0 : 0;
    const d8 = audit ? Number(audit.d8_score) || 0 : 0;
    const d9 = audit ? Number(audit.d9_score) || 0 : 0;
    const d10 = audit ? Number(audit.d10_score) || 0 : 0;

    const prCount = prResult.rows.length;
    const prRows = prResult.rows as Record<string, unknown>[];

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    let blockingIssues: unknown[] = [];
    if (audit?.blocking_issues) {
      try {
        blockingIssues = JSON.parse(audit.blocking_issues as string) as unknown[];
      } catch { /* ignore */ }
    }

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Atlas, the CTO agent for ${companyName}. Your job is to assess code quality, architecture health, and technical risk. Be precise and technical.`
    );

    const userPrompt = `Current state:
Audit composite score: ${composite}/100.
Dimension scores: [d1=${d1} Functional Completeness, d2=${d2} Experience Coherence, d3=${d3} Trust Density, d4=${d4} Value Legibility, d5=${d5} Operational Readiness, d6=${d6} Commercial Integrity, d7=${d7} Self-Sufficiency, d8=${d8} Competitive Defensibility, d9=${d9} Launch Readiness, d10=${d10} Stranger Test].
Open remediation PRs: ${prCount}.${prCount > 0 ? ` PRs: ${prRows.map(p => `${p.blocking_issue_dimension as string}: ${p.blocking_issue_summary as string}`).join('; ')}` : ''}
Blocking issues: ${blockingIssues.length}.
Active tech stressors: ${stressorList}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "actions_proposed": [
    {
      "title": "string",
      "description": "string",
      "expected_impact": "string",
      "urgency": "high" | "medium" | "low"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003; // Approximate Sonnet pricing

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

    // ── 7. Build decisions for high-urgency actions ───────────────────────────
    const pendingDecisions: AgentDecision[] = [];

    for (const action of (parsed.actions_proposed ?? [])) {
      if (action.urgency === 'high') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Atlas (CTO) identified: ${action.description}`,
          expected_impact: action.expected_impact,
          action_type: 'technical_remediation',
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 7b. Create remediations from high/critical findings ───────────────────
    const actionsTaken: AgentAction[] = [];

    for (const action of (parsed.actions_proposed ?? [])) {
      if (action.urgency !== 'high') continue;

      // Determine remediation type from title/description keywords
      const titleLower = action.title.toLowerCase();
      const descLower = action.description.toLowerCase();
      let remediationType = 'code_quality';
      if (titleLower.includes('security') || descLower.includes('security') ||
          titleLower.includes('vuln') || descLower.includes('vuln') ||
          titleLower.includes('cve') || descLower.includes('auth')) {
        remediationType = 'security';
      } else if (titleLower.includes('debt') || descLower.includes('tech debt') ||
                 titleLower.includes('refactor') || descLower.includes('refactor')) {
        remediationType = 'code_quality';
      }

      try {
        const remId = await createRemediation({
          productId,
          agentName: 'atlas',
          sessionId: context.agentInstance.id,
          remediationType,
          title: action.title,
          description: action.description,
          severity: 'high',
          suggestedFix: action.expected_impact,
        });

        actionsTaken.push({
          id: nanoid(),
          type: 'create_remediation',
          description: `Created high remediation: ${action.title}`,
          authority_level: 0,
          executed: true,
          executed_at: new Date().toISOString(),
          target: 'agent_remediations',
          result: remId,
        });
      } catch {
        // Remediation creation failure is non-fatal
      }
    }

    // Also handle observations that mention critical issues
    for (const obs of (parsed.observations ?? [])) {
      const obsLower = obs.toLowerCase();
      if (obsLower.includes('critical') && (
        obsLower.includes('security') || obsLower.includes('vulnerab') || obsLower.includes('exploit')
      )) {
        try {
          const remId = await createRemediation({
            productId,
            agentName: 'atlas',
            sessionId: context.agentInstance.id,
            remediationType: 'security',
            title: obs.slice(0, 100),
            description: obs,
            severity: 'critical',
          });

          actionsTaken.push({
            id: nanoid(),
            type: 'create_remediation',
            description: `Created critical security remediation: ${obs.slice(0, 80)}`,
            authority_level: 0,
            executed: true,
            executed_at: new Date().toISOString(),
            target: 'agent_remediations',
            result: remId,
          });
        } catch {
          // Non-fatal
        }
      }
    }

    // ── 8. Record analysis complete action ────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed technical analysis: composite score ${composite}/100, ${prCount} open PRs, ${stressorRows.length} active stressors`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction, ...actionsTaken],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Atlas completed technical review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default AtlasAgent;
