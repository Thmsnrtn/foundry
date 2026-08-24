// =============================================================================
// FOUNDRY — Harbor Agent (Customer Success)
// Domain: Customer success, retention, health monitoring
// Cadence: 12 hours
// v2: Emits customerSignals → customer_intelligence, agentMessages to forge/beacon
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  CustomerSignal, AgentMessageSignal, OutboundActionSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { pctOfFraction, measured } from '../../ai/measured.js';

interface HarborClaudeResponse {
  observations: string[];
  retention_actions: Array<{
    type: 'outreach' | 'intervention' | 'product_feedback' | 'health_check';
    title: string;
    description: string;
    target_segment: string;
    estimated_reactivation_pct: number;
  }>;
  customer_signals: Array<{
    external_id: string;
    name?: string;
    email?: string;
    stage: 'new' | 'active' | 'at_risk' | 'churned' | 'reactivated';
    health_login_score?: number;
    health_feature_score?: number;
    health_sentiment_score?: number;
    health_billing_score?: number;
    note: string;
  }>;
  at_risk_alerts: Array<{
    segment: string;
    risk_reason: string;
    recommended_action: string;
    urgency: 'immediate' | 'this_week' | 'monitor';
  }>;
  domain_health_score?: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class HarborAgent extends BaseAgent {
  getName(): AgentName { return 'harbor'; }
  getRole(): string { return 'Customer Success'; }
  getActivationCadenceHours(): number { return 12; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query latest metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT activation_rate, day_30_retention, churn_rate, nps_score, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [productId]
    );

    // ── 2. Query last 3 cohorts ───────────────────────────────────────────────
    const cohortsResult = await db(
      `SELECT acquisition_period, acquisition_channel, founder_count, activated_count,
              retained_day_7, retained_day_30, retained_day_60, churned_count
       FROM cohorts
       WHERE product_id = ?
       ORDER BY acquisition_period DESC
       LIMIT 3`,
      [productId]
    );

    // ── 3. Query retention/churn stressors ────────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at
       FROM stressor_history
       WHERE product_id = ?
         AND status = 'active'
         AND (
           LOWER(stressor_name) LIKE '%retention%'
           OR LOWER(stressor_name) LIKE '%churn%'
           OR LOWER(stressor_name) LIKE '%customer%'
           OR LOWER(stressor_name) LIKE '%support%'
         )
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END`,
      [productId]
    );

    // ── 4. Query existing customer_intelligence for context ───────────────────
    const atRiskResult = await db(
      `SELECT external_customer_id AS external_id, account_name AS name, email,
              stage, health_score, mrr_cents
       FROM customer_intelligence
       WHERE product_id = ? AND stage IN ('at_risk', 'churned')
       ORDER BY health_score ASC
       LIMIT 10`,
      [productId]
    );

    // ── 5. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0 && cohortsResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No customer success data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting customer metrics',
      };
      return {
        observations: ['No customer success data available yet — Harbor will monitor retention and health metrics as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Harbor is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // ── 6. Build prompt data ──────────────────────────────────────────────────
    const metrics = metricsResult.rows.length > 0
      ? (metricsResult.rows[0] as Record<string, unknown>)
      : null;
    // NULL MEANS THE COMPANY HAS NOT REPORTED IT. These were `|| 0`, which put
    // `Churn rate: 0.0%. NPS: 0.0.` into a prompt whose system message says "You
    // do not hedge when customer data is clear" — a model told to be confident,
    // handed facts nobody observed. Worse, the activation threshold below fired
    // a founder-facing alert on that zero. See `ai/measured.ts`.
    const asPct = (v: unknown): number | null => {
      const n = v === null || v === undefined ? null : Number(v);
      return n === null || !Number.isFinite(n) ? null : n * 100;
    };
    const activationRate = asPct(metrics?.activation_rate);
    const churnRate = asPct(metrics?.churn_rate);

    const cohortRows = cohortsResult.rows as Record<string, unknown>[];
    let cohortTrend = 'No cohort data';
    if (cohortRows.length > 0) {
      cohortTrend = cohortRows.map(c => {
        const total = Number(c.founder_count) || 1;
        const activated = Number(c.activated_count) || 0;
        const retDay30 = Number(c.retained_day_30) || 0;
        const actPct = ((activated / total) * 100).toFixed(1);
        const retPct = ((retDay30 / total) * 100).toFixed(1);
        return `${c.acquisition_period as string} (${c.acquisition_channel as string ?? 'unknown'}): activation=${actPct}%, day30_retention=${retPct}%`;
      }).join(' | ');
    }

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s => `${s.stressor_name as string} [${s.severity as string}]: ${s.signal as string}`).join('; ')
      : 'None active';

    const atRiskRows = atRiskResult.rows as Record<string, unknown>[];
    const atRiskSummary = atRiskRows.length > 0
      ? atRiskRows.map(r =>
          `${r.name as string ?? r.email as string ?? r.external_id as string} (stage=${r.stage}, health=${r.health_score}, mrr=$${((Number(r.mrr_cents) || 0) / 100).toFixed(0)})`
        ).join('; ')
      : 'None tracked yet';

    // Integration events (Stripe signals are most relevant to Harbor)
    const stripeEvents = (context.integrationEvents ?? []).filter(e => e.source === 'stripe');
    const stripeContext = stripeEvents.length > 0
      ? `Stripe signals: ${stripeEvents.map(e => e.summary).join(' | ')}`
      : '';

    // ── 7. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Harbor, the Chief Customer Officer for ${companyName}. You are the CEO's early warning system for revenue at risk.

Your core belief: churn is never a surprise — it's always telegraphed 30-60 days in advance by behavioral signals that nobody watched. Your job is to watch them.

You name specific accounts, specific ARR amounts, and specific intervention windows. You do not say "retention is at risk" — you say "Account TechCorp ($1,200 MRR) has been silent for 23 days and their last support ticket was marked frustrated. If you do not reach out in the next 7 days, the probability of churn exceeds 70% based on the pattern we've seen 4 times this quarter."

You also identify expansion signals — accounts showing power-user behavior that haven't been offered a higher tier. You quantify the expansion opportunity in dollars, not potential.

You are direct, named, and specific. You do not hedge when customer data is clear.`
    );

    // WHAT HARBOR SAYS IT DOES. Its system prompt above claims churn "is always
    // telegraphed 30-60 days in advance by behavioral signals that nobody
    // watched. Your job is to watch them." The signal was being written to
    // `customer_health_snapshots` on every health refresh and read by nothing,
    // so the one thing Harbor claims to be for was the one thing it could not
    // see. It is told now, and told nothing when there is nothing to tell.
    const { getFallingCustomers, TREND_WINDOW_DAYS } = await import(
      '../../institution/company-customers.js');
    const falling = await getFallingCustomers(productId);
    const fallingLine = falling.length === 0
      ? `No customer's health has fallen meaningfully in ${TREND_WINDOW_DAYS} days (or there is not enough history to say).`
      : `Falling health, worst first: ${falling.slice(0, 5).map((t) =>
        `${t.customerId} ${Math.round(t.earliestScore)}→${Math.round(t.latestScore)} over ${t.daysObserved}d`).join('; ')}.`;

    const userPrompt = `Activation rate: ${pctOfFraction(metrics?.activation_rate)}. Day-30 retention: ${pctOfFraction(metrics?.day_30_retention)}. Churn rate: ${pctOfFraction(metrics?.churn_rate)}. NPS: ${measured(metrics?.nps_score, 1)}.
Cohort retention trend: ${cohortTrend}.
Retention stressors: ${stressorList}.
${fallingLine}
Known at-risk customers (${atRiskRows.length}): ${atRiskSummary}.${stripeContext ? `\n${stripeContext}` : ''}

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "retention_actions": [
    {
      "type": "outreach" | "intervention" | "product_feedback" | "health_check",
      "title": "string",
      "description": "string",
      "target_segment": "string",
      "estimated_reactivation_pct": number
    }
  ],
  "customer_signals": [
    {
      "external_id": "string (use email or Stripe ID if identifiable, else 'segment:<name>')",
      "name": "string (optional)",
      "email": "string (optional)",
      "stage": "new" | "active" | "at_risk" | "churned" | "reactivated",
      "health_login_score": number (0-100, optional),
      "health_feature_score": number (0-100, optional),
      "health_sentiment_score": number (0-100, optional),
      "health_billing_score": number (0-100, optional),
      "note": "string (agent's assessment)"
    }
  ],
  "at_risk_alerts": [
    {
      "segment": "string",
      "risk_reason": "string",
      "recommended_action": "string",
      "urgency": "immediate" | "this_week" | "monitor"
    }
  ],
  "domain_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have no
    evidence to score the domain on — an omitted score is recorded as unknown,
    and a guessed one is recorded as a measurement,
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: HarborClaudeResponse;
    try {
      parsed = parseJSONResponse<HarborClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Harbor encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Harbor experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
      };
    }

    // ── 8. Build decisions for outreach campaigns ─────────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const action of (parsed.retention_actions ?? [])) {
      if (action.type === 'outreach') {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Harbor identified outreach opportunity for ${action.target_segment}: ${action.description}`,
          expected_impact: `Estimated ${action.estimated_reactivation_pct.toFixed(1)}% reactivation rate for target segment.`,
          action_type: 'cs_outreach',
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 9. Build outbound actions for urgent at-risk alerts ───────────────────
    const outboundActions: OutboundActionSignal[] = [];
    for (const alert of (parsed.at_risk_alerts ?? [])) {
      if (alert.urgency === 'immediate') {
        outboundActions.push({
          action_type: 'cs_retention_outreach',
          description: `URGENT: ${alert.segment} — ${alert.risk_reason}. Action: ${alert.recommended_action}`,
          parameters: { segment: alert.segment, risk_reason: alert.risk_reason, recommended_action: alert.recommended_action },
          authority_level: 1, // Harbor has authority level 1
        });
      }
    }

    // ── 10. Message Forge and Beacon if churn is elevated ────────────────────
    const agentMessages: AgentMessageSignal[] = [];
    // AN UNKNOWN RATE RAISES NOTHING. A threshold crossed by a fabricated zero
    // is an alert about a company that reported no metrics at all.
    if ((churnRate !== null && churnRate > 5)
        || (parsed.at_risk_alerts ?? []).some(a => a.urgency === 'immediate')) {
      agentMessages.push({
        to_agent: 'forge',
        message_type: 'alert',
        priority: churnRate !== null && churnRate > 10 ? 'critical' : 'high',
        subject: `Elevated churn signal: ${pctOfFraction(metrics?.churn_rate)} — revenue impact risk`,
        body: `Harbor detected elevated churn (${pctOfFraction(metrics?.churn_rate)}). At-risk segments: ${
          (parsed.at_risk_alerts ?? []).map(a => a.segment).join(', ') || 'see analysis'
        }. Recommend reviewing pricing and expansion strategy.`,
      });
    }
    if (activationRate !== null && activationRate < 30) {
      agentMessages.push({
        to_agent: 'beacon',
        message_type: 'insight',
        priority: 'high',
        subject: `Low activation rate (${pctOfFraction(metrics?.activation_rate)}) — acquisition quality concern`,
        body: `Harbor reports activation at ${pctOfFraction(metrics?.activation_rate)}. This may indicate ICP mismatch in acquisition. Cohort trend: ${cohortTrend.slice(0, 200)}.`,
      });
    }

    // ── 11. Map customer signals ──────────────────────────────────────────────
    const customerSignals: CustomerSignal[] = (parsed.customer_signals ?? []).map(sig => ({
      external_id: sig.external_id,
      name: sig.name,
      email: sig.email,
      stage: sig.stage,
      health_login_score: sig.health_login_score,
      health_feature_score: sig.health_feature_score,
      health_sentiment_score: sig.health_sentiment_score,
      health_billing_score: sig.health_billing_score,
      note: sig.note,
    }));

    // ── 12. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed CS analysis: activation ${pctOfFraction(metrics?.activation_rate)}, churn ${pctOfFraction(metrics?.churn_rate)}, NPS ${measured(metrics?.nps_score, 1)}, ${customerSignals.length} customer signals`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Harbor completed customer success review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score,
      customerSignals,
      outboundActions,
      agentMessages,
    };
  }
}

export default HarborAgent;
