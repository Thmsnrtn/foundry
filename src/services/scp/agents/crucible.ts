// =============================================================================
// FOUNDRY — Crucible Agent (QA Lead)
// Domain: Test coverage, quality gates, regression prevention
// Cadence: 24 hours
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface CrucibleClaudeResponse {
  observations: string[];
  quality_alerts: Array<{
    type: 'regression_risk' | 'coverage_gap' | 'test_needed';
    severity: 'high' | 'medium' | 'low';
    description: string;
    recommendation: string;
  }>;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class CrucibleAgent extends BaseAgent {
  getName(): AgentName { return 'crucible'; }
  getRole(): string { return 'QA Lead'; }
  getActivationCadenceHours(): number { return 24; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query audit_scores for d1, d5, d9 ─────────────────────────────────
    const auditResult = await db(
      `SELECT d1_score, d5_score, d9_score, findings, blocking_issues, created_at
       FROM audit_scores
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query remediation PRs — count and status breakdown ─────────────────
    const prResult = await db(
      `SELECT status, COUNT(*) as count
       FROM remediation_prs
       WHERE product_id = ?
       GROUP BY status`,
      [productId]
    );

    // ── 3. Query quality-related stressors ────────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%bug%'
           OR LOWER(stressor_name) LIKE '%crash%'
           OR LOWER(stressor_name) LIKE '%error%'
           OR LOWER(stressor_name) LIKE '%regression%'
           OR LOWER(stressor_name) LIKE '%test%'
           OR LOWER(stressor_name) LIKE '%quality%'
           OR LOWER(stressor_name) LIKE '%broken%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (auditResult.rows.length === 0 && prResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No quality data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting audit and PR data',
      };
      return {
        observations: ['No quality audit data available yet — Crucible will track test coverage and regression risks as audit data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Crucible is calibrating — no significant activity to report.',
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
    const d1 = audit ? Number(audit.d1_score) || 0 : 0;
    const d5 = audit ? Number(audit.d5_score) || 0 : 0;
    const d9 = audit ? Number(audit.d9_score) || 0 : 0;

    // Count blocking issues from audit
    let blockingIssueCount = 0;
    if (audit?.blocking_issues) {
      try {
        const issues = JSON.parse(audit.blocking_issues as string) as unknown[];
        blockingIssueCount = issues.length;
      } catch { /* ignore */ }
    }

    // Count relevant findings from audit
    let qualityFindings: string[] = [];
    if (audit?.findings) {
      try {
        const findings = JSON.parse(audit.findings as string) as Array<Record<string, unknown>>;
        qualityFindings = findings
          .filter(f => {
            const text = JSON.stringify(f).toLowerCase();
            return text.includes('test') || text.includes('bug') || text.includes('error') ||
                   text.includes('function') || text.includes('coverage') || text.includes('regression');
          })
          .map(f => String(f.finding ?? f.description ?? f.title ?? '').slice(0, 120))
          .filter(Boolean)
          .slice(0, 5);
      } catch { /* ignore */ }
    }

    // Build PR status breakdown
    const prRows = prResult.rows as Record<string, unknown>[];
    const prStatusMap: Record<string, number> = {};
    for (const row of prRows) {
      prStatusMap[row.status as string] = Number(row.count) || 0;
    }
    const prBreakdown = Object.entries(prStatusMap)
      .map(([status, count]) => `${status}:${count}`)
      .join(', ') || 'No PRs';

    const totalOpenPrs = (prStatusMap['pr_open'] ?? 0) + (prStatusMap['generating'] ?? 0);
    const mergedPrs = prStatusMap['merged'] ?? 0;
    const failedPrs = prStatusMap['failed'] ?? 0;

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Crucible, the QA Lead for ${companyName}. You ensure software quality, track regression risks, and maintain quality gates. Focus on preventing production issues, not just finding bugs.`
    );

    const userPrompt = `Functional Completeness: ${d1}/10. Operational Readiness: ${d5}/10. Launch Readiness: ${d9}/10.
Blocking issues in latest audit: ${blockingIssueCount}.
${qualityFindings.length > 0 ? `Quality-related findings: ${qualityFindings.join('; ')}` : ''}
Remediation PRs status: ${prBreakdown} (${totalOpenPrs} open, ${mergedPrs} merged, ${failedPrs} failed).
Quality stressors: ${stressorList}.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "quality_alerts": [
    {
      "type": "regression_risk" | "coverage_gap" | "test_needed",
      "severity": "high" | "medium" | "low",
      "description": "string",
      "recommendation": "string"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 1024);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: CrucibleClaudeResponse;
    try {
      parsed = parseJSONResponse<CrucibleClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Crucible encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Crucible experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 7. No explicit AgentDecisions for Crucible — it uses notify (level 1) ─
    // Critical quality alerts are surfaced through observations and briefing,
    // with the agent relying on the notify+override authority model.
    const pendingDecisions: AgentDecision[] = [];

    // ── 8. Record analysis action ─────────────────────────────────────────────
    const highAlerts = (parsed.quality_alerts ?? []).filter(a => a.severity === 'high').length;
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed QA analysis: d1=${d1}/10, d5=${d5}/10, d9=${d9}/10, ${totalOpenPrs} open PRs, ${highAlerts} high-severity quality alerts`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Crucible completed QA review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
    };
  }
}

export default CrucibleAgent;
