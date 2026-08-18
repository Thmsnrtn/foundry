// =============================================================================
// FOUNDRY — Shield Agent (Legal/Compliance)
// Domain: Compliance monitoring, terms, privacy, risk flags
// Cadence: 168 hours (weekly)
// v2: Emits outboundActions for compliance actions, agentMessages to Ledger/broadcast,
//     lifecycle-aware compliance assessment
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface ShieldClaudeResponse {
  observations: string[];
  compliance_status: {
    overall_risk: 'low' | 'medium' | 'high' | 'critical';
    active_risks: string[];
    upcoming_deadlines: Array<{
      requirement: string;
      deadline_days: number;
      severity: 'mandatory' | 'recommended';
    }>;
  };
  compliance_actions: Array<{
    type: 'policy_update' | 'legal_review' | 'compliance_filing' | 'risk_mitigation';
    title: string;
    description: string;
    authority_level: 0 | 1 | 2;
    deadline_days: number | null;
  }>;
  legal_content_updates: Array<{
    document: 'terms_of_service' | 'privacy_policy' | 'cookie_policy' | 'dpa';
    update_reason: string;
    draft_summary: string;
  }>;
  domain_health_score: number;
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

    // ── 1. Query products for company age and lifecycle state ─────────────────
    // `lifecycle_state` has never been a column on `products`. The column is
    // `company_lifecycle_state`, so this query raised SQLITE_ERROR on every
    // run and Shield's session was marked failed before it read anything.
    const productResult = await db(
      `SELECT created_at, company_lifecycle_state AS lifecycle_state
       FROM products
       WHERE id = ?`,
      [productId]
    );

    // ── 2. Query founders for company details ──────────────────────────────────
    // Four columns that do not exist, on a table that does not carry
    // `product_id`. The founder is reached through `products.owner_id`, their
    // name is `name`, and the company's name and URL live on the product —
    // which is where they always were, because the company IS the product.
    const founderResult = await db(
      `SELECT f.name AS founder_name, f.email,
              p.name AS company_name, p.github_repo_url AS company_url
       FROM products p JOIN founders f ON f.id = p.owner_id
       WHERE p.id = ?
       LIMIT 1`,
      [productId]
    );

    // ── 3. Query integrations for credential expiry ───────────────────────────
    const integrationsResult = await db(
      `SELECT type AS source, last_synced_at,
              datetime(last_synced_at, '+90 days') as estimated_expiry
       FROM integrations
       WHERE product_id = ?
         AND status = 'active'`,
      [productId]
    );

    // ── 4. Query legal/compliance stressors ───────────────────────────────────
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

    // ── 5. Handle no-data case ────────────────────────────────────────────────
    if (productResult.rows.length === 0 && stressorResult.rows.length === 0) {
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
        domainHealthScore: 50,
      };
    }

    // ── 6. Build prompt data ──────────────────────────────────────────────────
    const productRow = productResult.rows.length > 0
      ? (productResult.rows[0] as Record<string, unknown>)
      : null;
    const lifecycleState = productRow ? (productRow.lifecycle_state as string ?? 'learning') : 'learning';
    const companyCreatedAt = productRow ? (productRow.created_at as string) : null;
    const companyAgeDays = companyCreatedAt
      ? Math.floor((Date.now() - new Date(companyCreatedAt).getTime()) / 86400000)
      : null;

    const founderRow = founderResult.rows.length > 0
      ? (founderResult.rows[0] as Record<string, unknown>)
      : null;
    const founderContext = founderRow
      ? `Founder: ${founderRow.founder_name as string ?? 'Unknown'}. Company URL: ${founderRow.company_url as string ?? 'Not set'}.`
      : 'No founder details available.';

    const integrationRows = integrationsResult.rows as Record<string, unknown>[];
    const expiringIntegrations = integrationRows.filter(r => {
      const expiry = r.estimated_expiry as string;
      if (!expiry) return false;
      const daysUntilExpiry = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
      return daysUntilExpiry < 30;
    });
    const integrationContext = expiringIntegrations.length > 0
      ? `Credentials expiring soon: ${expiringIntegrations.map(r => `${r.source as string} (est. ${r.estimated_expiry as string})`).join(', ')}`
      : `${integrationRows.length} active integrations, all credentials appear current`;

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s =>
          `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string} — action: ${s.neutralizing_action as string ?? 'none specified'}`
        ).join('; ')
      : 'None active';

    // Lifecycle-aware compliance context
    const lifecycleGuidance: Record<string, string> = {
      setup: 'Early stage: ensure basic Terms of Service and Privacy Policy exist.',
      learning: 'Early stage: ensure basic Terms of Service and Privacy Policy exist. Focus on data handling clarity.',
      operating: 'Growth stage: GDPR compliance, cookie consent, and SOC2 planning are priorities.',
      optimizing: 'Growth stage: GDPR/CCPA enforcement, DPA agreements, SOC2 Type II planning required.',
      scaling: 'Scaling stage: full compliance program needed — SOC2, GDPR, CCPA, DPA, vendor reviews.',
    };
    const lifecycleHint = lifecycleGuidance[lifecycleState] ?? lifecycleGuidance.learning;

    // Include unread messages relevant to compliance
    const unreadMessages = (context.unreadMessages ?? []);
    const unreadContext = unreadMessages.length > 0
      ? `Unread agent messages: ${unreadMessages.map(m => `[${m.from_agent}] ${m.subject}: ${m.body.slice(0, 100)}`).join(' | ')}`
      : '';

    // ── 7. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Shield, the General Counsel for ${companyName}. You do not produce compliance checklists — you identify the specific legal and reputational exposure that could kill the company or the fundraise.

Your job is triage: what are the 1-2 legal/compliance items that, if unaddressed, would create a material problem in a due diligence process, a regulatory audit, or a public incident?

You are direct about risk severity. You say: "The current data processing agreement with Enterprise Customer X is missing a DPA under GDPR Article 28. If this customer experiences a breach or files a complaint, we are exposed to regulatory action. This needs to be resolved in the next 14 days."

You think about: data handling practices vs. your privacy policy, terms of service vs. what the product actually does, employment agreements vs. IP ownership, and the gap between what we tell customers and what we can actually deliver.

You flag emerging regulatory developments that could affect the company's operations or market in the next 12-24 months, with enough lead time to adapt.

You never create panic about theoretical risks. You rank by probability × impact and only surface what actually requires action.`
    );

    const userPrompt = `Company: ${companyName}. Lifecycle state: ${lifecycleState}. ${companyAgeDays !== null ? `Company age: ${companyAgeDays} days.` : ''}
${founderContext}
${lifecycleHint}
Active compliance stressors: ${stressorList}.
Integration credential status: ${integrationContext}.
${unreadContext ? `\n${unreadContext}` : ''}

Assess compliance posture. Consider: data privacy (GDPR/CCPA), terms of service adequacy, security disclosures, billing practices, and upcoming requirements based on lifecycle stage.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "compliance_status": {
    "overall_risk": "low" | "medium" | "high" | "critical",
    "active_risks": ["string", ...],
    "upcoming_deadlines": [
      {
        "requirement": "string",
        "deadline_days": number (days from now),
        "severity": "mandatory" | "recommended"
      }
    ]
  },
  "compliance_actions": [
    {
      "type": "policy_update" | "legal_review" | "compliance_filing" | "risk_mitigation",
      "title": "string",
      "description": "string",
      "authority_level": 0 | 1 | 2,
      "deadline_days": number | null
    }
  ],
  "legal_content_updates": [
    {
      "document": "terms_of_service" | "privacy_policy" | "cookie_policy" | "dpa",
      "update_reason": "string",
      "draft_summary": "string"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
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
        domainHealthScore: 50,
      };
    }

    // ── 8. Build pending decisions for authority_level=2 compliance actions ───
    const pendingDecisions: AgentDecision[] = [];
    const status = parsed.compliance_status;

    for (const action of (parsed.compliance_actions ?? [])) {
      if (action.authority_level === 2) {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Shield (Compliance) identified required action: ${action.description}`,
          expected_impact: `Deadline: ${action.deadline_days !== null ? `${action.deadline_days} days` : 'ongoing'}`,
          action_type: action.type,
          action_data: { raw_action: action },
          expires_at: action.deadline_days !== null
            ? new Date(Date.now() + action.deadline_days * 86400 * 1000).toISOString()
            : new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 9. Build outbound actions (exclude policy_update; authority_level <= 2) ─
    const outboundActions: OutboundActionSignal[] = [];
    for (const action of (parsed.compliance_actions ?? [])) {
      if (action.type !== 'policy_update' && action.authority_level <= 2) {
        outboundActions.push({
          action_type: action.type,
          description: action.description,
          parameters: {
            title: action.title,
            deadline_days: action.deadline_days,
          },
          authority_level: action.authority_level,
        });
      }
    }

    // ── 10. Build agent messages ──────────────────────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];

    // Broadcast critical when any deadline < 14 days
    const urgentDeadlines = (status?.upcoming_deadlines ?? []).filter(d => d.deadline_days < 14);
    if (urgentDeadlines.length > 0) {
      agentMessages.push({
        to_agent: 'broadcast',
        message_type: 'alert',
        priority: 'critical',
        subject: `${urgentDeadlines.length} compliance deadline(s) within 14 days`,
        body: `Shield flagged urgent compliance deadlines: ${urgentDeadlines.map(d => `${d.requirement} (${d.deadline_days} days, ${d.severity})`).join('; ')}. Immediate founder attention required.`,
      });
    }

    // Alert Ledger when overall_risk is high or critical
    const overallRisk = status?.overall_risk;
    if (overallRisk === 'high' || overallRisk === 'critical') {
      agentMessages.push({
        to_agent: 'ledger',
        message_type: 'alert',
        priority: overallRisk === 'critical' ? 'critical' : 'high',
        subject: `Compliance risk level: ${overallRisk} — potential financial exposure`,
        body: `Shield assessed overall compliance risk as ${overallRisk}. Active risks: ${(status?.active_risks ?? []).join('; ')}. Ledger should evaluate financial impact and potential remediation costs.`,
      });
    }

    // ── 11. Record analysis action ────────────────────────────────────────────
    const criticalCount = (parsed.compliance_actions ?? []).filter(a => a.authority_level === 2).length;
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed compliance review: risk=${overallRisk ?? 'unknown'}, lifecycle=${lifecycleState}, ${stressorRows.length} stressors, ${criticalCount} critical actions`,
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
      domainHealthScore: parsed.domain_health_score ?? 50,
      outboundActions,
      agentMessages,
    };
  }
}

export default ShieldAgent;
