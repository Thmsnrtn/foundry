// =============================================================================
// FOUNDRY — Shield Agent (Legal/Compliance)
// Domain: Compliance monitoring, terms, privacy, risk flags
// Cadence: 168 hours (weekly)
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface ShieldClaudeResponse {
  observations: string[];
  risk_flags: Array<{
    area: string;
    severity: 'critical' | 'medium' | 'low';
    description: string;
    recommendation: string;
  }>;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class ShieldAgent extends BaseAgent {
  getName(): AgentName { return 'shield'; }
  getRole(): string { return 'Compliance'; }
  getActivationCadenceHours(): number { return 168; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query audit_scores for d3 (Trust Density) and d6 (Commercial Integrity) ──
    const auditResult = await db(
      `SELECT d3_score, d6_score, findings, created_at
       FROM audit_scores
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query legal/compliance/privacy stressors ───────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at, neutralizing_action
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%legal%'
           OR LOWER(stressor_name) LIKE '%compliance%'
           OR LOWER(stressor_name) LIKE '%privacy%'
           OR LOWER(stressor_name) LIKE '%terms%'
           OR LOWER(stressor_name) LIKE '%gdpr%'
           OR LOWER(stressor_name) LIKE '%security%'
           OR LOWER(stressor_name) LIKE '%data%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 3. Query product_dna for business model context ───────────────────────
    const dnaResult = await db(
      `SELECT business_model, revenue_streams, icp_description
       FROM product_dna
       WHERE product_id = ?`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (auditResult.rows.length === 0 && stressorResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No compliance data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Monitoring compliance landscape',
      };
      return {
        observations: ['No compliance data available yet — Shield will monitor legal and privacy risks as the product matures.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Shield is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const audit = auditResult.rows.length > 0
      ? (auditResult.rows[0] as Record<string, unknown>)
      : null;
    const d3 = audit ? Number(audit.d3_score) || 0 : 0;
    const d6 = audit ? Number(audit.d6_score) || 0 : 0;

    // Extract relevant compliance findings from audit findings JSON
    let complianceFindings: string[] = [];
    if (audit?.findings) {
      try {
        const findings = JSON.parse(audit.findings as string) as Array<Record<string, unknown>>;
        complianceFindings = findings
          .filter(f => {
            const text = JSON.stringify(f).toLowerCase();
            return text.includes('trust') || text.includes('privacy') || text.includes('terms') ||
                   text.includes('compliance') || text.includes('commercial') || text.includes('legal');
          })
          .map(f => String(f.finding ?? f.description ?? f.title ?? JSON.stringify(f)).slice(0, 120));
      } catch { /* ignore */ }
    }

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s =>
          `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string} — action: ${s.neutralizing_action as string}`
        ).join('; ')
      : 'None active';

    const dna = dnaResult.rows.length > 0
      ? (dnaResult.rows[0] as Record<string, unknown>)
      : null;
    const businessModel = dna ? ((dna.business_model as string) ?? 'Not specified') : 'Not specified';
    const revenueStreams = dna?.revenue_streams
      ? (() => { try { return JSON.parse(dna.revenue_streams as string) as string[]; } catch { return []; } })().join(', ')
      : 'Not specified';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Shield, the Compliance agent for ${companyName}. You flag legal risks, ensure compliance, and protect the company from regulatory and reputational harm. Focus on actionable, specific recommendations.`
    );

    const userPrompt = `Trust Density score: ${d3}/10. Commercial Integrity: ${d6}/10.
Business model: ${businessModel}. Revenue streams: ${revenueStreams}.
Active compliance stressors: ${stressorList}.
${complianceFindings.length > 0 ? `Compliance-related audit findings: ${complianceFindings.join('; ')}` : ''}

Assess compliance posture for a SaaS company. Consider: data privacy, terms of service, GDPR/CCPA, security disclosures, commercial agreements, billing practices.
Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "risk_flags": [
    {
      "area": "string",
      "severity": "critical" | "medium" | "low",
      "description": "string",
      "recommendation": "string"
    }
  ],
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 1024);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: ShieldClaudeResponse;
    try {
      parsed = parseJSONResponse<ShieldClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Shield encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Shield experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
      };
    }

    // ── 7. Build decisions for critical risk flags (authority_level=2) ────────
    const pendingDecisions: AgentDecision[] = [];
    for (const flag of (parsed.risk_flags ?? [])) {
      if (flag.severity === 'critical') {
        const decision: AgentDecision = {
          id: nanoid(),
          agent_name: this.getName(),
          title: `COMPLIANCE RISK: ${flag.area}`,
          description: flag.description,
          rationale: `Shield (Compliance) identified critical risk in ${flag.area}: ${flag.description}`,
          expected_impact: flag.recommendation,
          action_type: 'compliance_remediation',
          action_data: { raw_action: flag },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 8. Record analysis action ─────────────────────────────────────────────
    const criticalCount = (parsed.risk_flags ?? []).filter(f => f.severity === 'critical').length;
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed compliance review: d3=${d3}/10, d6=${d6}/10, ${stressorRows.length} stressors, ${criticalCount} critical flags`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Shield completed compliance review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
    };
  }
}

export default ShieldAgent;
