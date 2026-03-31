// =============================================================================
// FOUNDRY — Sentinel Agent (DevOps)
// Domain: Infrastructure monitoring, deployment health, uptime
// Cadence: 6 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { createRemediation } from '../remediation.js';

interface SentinelClaudeResponse {
  observations: string[];
  alerts: Array<{
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    action_required: boolean;
  }>;
  domain_health_score: number;
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

    // ── 1. Query open/generating infra-related PRs ────────────────────────────
    const prResult = await db(
      `SELECT id, blocking_issue_summary, blocking_issue_dimension, status, created_at
       FROM remediation_prs
       WHERE product_id = ? AND status IN ('pr_open', 'generating')
       ORDER BY created_at DESC`,
      [productId]
    );

    // ── 2. Query infrastructure stressors ─────────────────────────────────────
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

    // ── 3. Query audit_scores for d5 (Operational Readiness) and d7 (Self-Sufficiency) ──
    const auditResult = await db(
      `SELECT d5_score, d7_score, created_at
       FROM audit_scores
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (prResult.rows.length === 0 && stressorResult.rows.length === 0 && auditResult.rows.length === 0) {
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
        domainHealthScore: 50,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const audit = auditResult.rows.length > 0
      ? (auditResult.rows[0] as Record<string, unknown>)
      : null;
    const d5 = audit ? Number(audit.d5_score) || 0 : 0;
    const d7 = audit ? Number(audit.d7_score) || 0 : 0;

    const prRows = prResult.rows as Record<string, unknown>[];
    const prCount = prRows.length;
    const prSummary = prRows.length > 0
      ? prRows.map(p => `[${p.status as string}] ${p.blocking_issue_dimension as string}: ${p.blocking_issue_summary as string}`).join('; ')
      : 'No open PRs';

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Sentinel, the DevOps agent for ${companyName}. You monitor infrastructure health and prevent operational failures. Prioritize reliability and uptime. Escalate critical issues immediately.`
    );

    const userPrompt = `Operational Readiness score: ${d5}/10. Self-Sufficiency: ${d7}/10.
Open infra PRs: ${prCount}.${prCount > 0 ? ` Details: ${prSummary}` : ''}
Infrastructure stressors: ${stressorList}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "alerts": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "string",
      "description": "string",
      "action_required": boolean
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 1024);
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
        domainHealthScore: 50,
      };
    }

    // ── 7. Build decisions for critical alerts ────────────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const alert of (parsed.alerts ?? [])) {
      if (alert.severity === 'critical' && alert.action_required) {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: `CRITICAL: ${alert.title}`,
          description: alert.description,
          rationale: `Sentinel (DevOps) detected critical infrastructure issue: ${alert.description}`,
          expected_impact: 'Resolving this issue prevents downtime and protects revenue.',
          action_type: 'infra_critical',
          action_data: { raw_action: alert },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 7b. Create remediations from infra alerts ─────────────────────────────
    const actionsTaken: AgentAction[] = [];

    for (const alert of (parsed.alerts ?? [])) {
      if (alert.severity !== 'critical' && alert.severity !== 'warning') continue;
      if (!alert.action_required) continue;

      // Map alert to remediation type
      const titleLower = alert.title.toLowerCase();
      const descLower = alert.description.toLowerCase();
      let remediationType = 'infra';
      if (titleLower.includes('performance') || descLower.includes('slow') ||
          titleLower.includes('latency') || descLower.includes('latency') ||
          titleLower.includes('response time') || descLower.includes('throughput')) {
        remediationType = 'performance';
      }

      const severity = alert.severity === 'critical' ? 'critical' : 'high';

      try {
        const remId = await createRemediation({
          productId,
          agentName: 'sentinel',
          sessionId: context.agentInstance.id,
          remediationType,
          title: alert.title,
          description: alert.description,
          severity,
        });

        actionsTaken.push({
          id: nanoid(),
          type: 'create_remediation',
          description: `Created ${severity} ${remediationType} remediation: ${alert.title}`,
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

    // ── 8. Record analysis action ─────────────────────────────────────────────
    const criticalCount = (parsed.alerts ?? []).filter(a => a.severity === 'critical').length;
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed infra analysis: d5=${d5}/10, d7=${d7}/10, ${prCount} open PRs, ${criticalCount} critical alerts`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction, ...actionsTaken],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Sentinel completed infrastructure review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default SentinelAgent;
