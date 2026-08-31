// =============================================================================
// FOUNDRY — Prism Agent (CFO)
// Domain: Financial health, runway, unit economics
// Cadence: 48 hours
// v2: Emits hypotheses for pricing/cost experiments, outboundActions for critical budget
//     alerts, agentMessages based on runway and burn rate signals
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { pctOfFraction, measured } from '../../ai/measured.js';

interface PrismClaudeResponse {
  observations: string[];
  ux_issues: Array<{
    area: string;
    impact: 'high' | 'medium' | 'low';
    suggestion: string;
  }>;
  financial_hypotheses: Array<{
    title: string;
    description: string;
    hypothesis: string;
    success_metric: string;
    success_threshold: number;
    test_duration_days: number;
  }>;
  revenue_attribution: Array<{
    channel: string;
    mrr_contribution_pct: number;
    cac_estimate: number;
  }>;
  /** Optional because the model is asked a product question over sources with
   *  no financial figure in them; it usually cannot state one. */
  runway_months?: number | null;
  burn_rate_trend: 'improving' | 'stable' | 'rising';
  domain_health_score?: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class PrismAgent extends BaseAgent {
  getName(): AgentName { return 'prism'; }
  // Ledger also answered 'CFO', and nothing reads this method at all — it is
  // declared abstract in `base.ts` and has no consumer anywhere, so the
  // collision was latent rather than visible. Named for what this agent is
  // prompted as and rostered as, so the first thing to group agents by role
  // does not find the same officer twice. That the string is now right does
  // not make the rest of this file product-shaped; see the campaign entry.
  getRole(): string { return 'Chief Product Officer'; }
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
        description: 'No product or usage data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting product and usage data',
      };
      return {
        // A PROMISE OF THE WRONG ANALYSIS. This told the founder Prism would
        // analyse unit economics and runway once data accumulated. Its three
        // sources are `audit_scores`, `beta_intake` and `metric_snapshots`, so
        // that day was never going to come; what it does analyse is whether the
        // product is getting closer to what customers want, which is also what
        // its prompt and the roster say.
        observations: ['No product or usage data available yet — Prism will analyse activation, retention and friction as data accumulates.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Prism is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const metrics = metricsResult.rows.length > 0
      ? (metricsResult.rows[0] as Record<string, unknown>)
      : null;
    // See `ai/measured.ts`: a company that has reported nothing is not a company
    // with a 0.0% activation rate, and a model asked to judge experience quality
    // should be told which of those it is looking at.

    const audit = auditResult.rows.length > 0
      ? (auditResult.rows[0] as Record<string, unknown>)
      : null;
    // 0/10 is the worst possible audit score. Never audited is not that.
    const d2 = measured(audit?.d2_score);
    const d4 = measured(audit?.d4_score);

    const betaRows = betaResult.rows as Record<string, unknown>[];
    const feedbackThemes: string[] = [];
    for (const row of betaRows) {
      if (row.positioning_feedback) feedbackThemes.push(String(row.positioning_feedback).slice(0, 120));
      if (row.activation_outcome) {
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
      `You are Prism, the Chief Product Officer for ${companyName}. You are responsible for one question: is the product getting closer to or further from what customers actually want?

You track activation rates, feature adoption depth, time-to-value, and the gap between what the company thinks customers want and what customer behavior shows. You are skeptical of roadmaps that aren't grounded in retention and activation data.

You are direct about feature creep and prioritization failure. If the product is adding features while activation is declining, you say: "We have shipped 7 features in the last 6 weeks. Activation rate has declined from 34% to 28% over the same period. The product is getting more complex and less immediately valuable. I recommend a 4-week freeze on new features focused exclusively on the activation flow."

You name specific friction points with specificity — not "onboarding needs improvement" but "63% of signups who reach the API key step do not complete it. This one step is responsible for approximately 40% of activation failures."

You defend the user experience when business pressure threatens it.`
    );

    const userPrompt = `Activation rate: ${pctOfFraction(metrics?.activation_rate)}. Day-30 retention: ${pctOfFraction(metrics?.day_30_retention)}.
UX audit scores: Experience Coherence ${d2 === 'unknown' ? 'unknown' : `${d2}/10`}, Value Legibility ${d4 === 'unknown' ? 'unknown' : `${d4}/10`}.
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
  "financial_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string",
      "success_threshold": number,
      "test_duration_days": number
    }
  ],
  "revenue_attribution": [
    {
      "channel": "string",
      "mrr_contribution_pct": number,
      "cac_estimate": number
    }
  ],
  "runway_months": number,
  "burn_rate_trend": "improving" | "stable" | "rising",
  "domain_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have no
    evidence to score the domain on — an omitted score is recorded as unknown,
    and a guessed one is recorded as a measurement,
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
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
          rationale: `Prism (CFO) identified high-impact friction in ${issue.area}: ${issue.suggestion}`,
          expected_impact: 'Expected to improve activation rate and reduce onboarding drop-off.',
          action_type: 'ux_improvement',
          action_data: { raw_action: issue },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        pendingDecisions.push(decision);
      }
    }

    // ── 8. No outbound actions ────────────────────────────────────────────────
    //
    // A CRITICAL BUDGET ALERT FROM AN AGENT THAT CANNOT SEE A BUDGET.
    //
    // This asked the model for `budget_alerts` and queued every 'critical' one
    // as a `budget_alert` outbound action reading "CRITICAL budget alert
    // [category]: message". The model producing them is told it is the Chief
    // Product Officer and asked whether the product is getting closer to what
    // customers want, over `audit_scores`, `beta_intake` and `metric_snapshots`
    // — three sources with no cost, no burn and no budget in them. Nothing it
    // said there could have been grounded; the field only gave it somewhere to
    // put an invention, and authority level 1 put that in front of the founder.
    //
    // Ledger is the agent with the financial data — `cost_events` and
    // `revenue_attributions` — and it already emits `budget_alert` from them.
    // The domain was not missing a watcher; it had two, one of them blind.
    const outboundActions: OutboundActionSignal[] = [];

    // ── 9. Build agent messages based on runway and burn rate ─────────────────
    const agentMessages: AgentMessageSignal[] = [];
    // A MESSAGE THAT STATES A RUNWAY MUST HAVE ONE — the same rule Crucible
    // carries a few files away, arrived at there and not brought here.
    //
    // This read `parsed.runway_months ?? 12`. The model that answers it is
    // asked a PRODUCT question ("is the product getting closer to or further
    // from what customers actually want?") over `audit_scores`, `beta_intake`
    // and `metric_snapshots` — three sources with no financial figure in them.
    // So the usual answer is no runway at all, and the fallback turned that
    // silence into a claim of twelve months' solvency.
    //
    // It was not inert. Below six it sends Beacon and Forge alerts at 'high' or
    // 'critical' reading "Prism reports runway of X months", asking two agents
    // to reprioritise acquisition and revenue against a number nothing
    // produced. Twelve happened to be a number that suppressed those; a
    // different default would have fired them for every company.
    //
    // Absence is not twelve, and it is not zero either. With no runway stated
    // there is no runway condition to evaluate, so nothing is said about it.
    const runwayMonths = parsed.runway_months;
    const burnTrend = parsed.burn_rate_trend ?? 'stable';

    if (runwayMonths != null && Number.isFinite(runwayMonths) && runwayMonths < 6) {
      agentMessages.push({
        to_agent: 'beacon',
        message_type: 'alert',
        priority: runwayMonths < 3 ? 'critical' : 'high',
        subject: `Runway critical: ${runwayMonths.toFixed(1)} months — accelerate acquisition`,
        body: `Prism reports runway of ${runwayMonths.toFixed(1)} months. Beacon must prioritize high-conversion acquisition channels to extend runway. Review CAC efficiency immediately.`,
      });
      agentMessages.push({
        to_agent: 'forge',
        message_type: 'alert',
        priority: runwayMonths < 3 ? 'critical' : 'high',
        subject: `Runway critical: ${runwayMonths.toFixed(1)} months — expand revenue`,
        body: `Prism reports runway of ${runwayMonths.toFixed(1)} months. Forge must identify expansion revenue and conversion improvements to reduce burn runway pressure.`,
      });
    }

    if (burnTrend === 'rising') {
      agentMessages.push({
        to_agent: 'compass',
        message_type: 'insight',
        priority: 'high',
        subject: 'Burn rate rising — strategic priority adjustment needed',
        body: `Prism detected rising burn rate trend. This should inform strategic priorities — consider pausing lower-ROI initiatives and focusing investment on direct revenue drivers.`,
      });
    }

    // ── 10. Build hypotheses from financial_hypotheses ────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.financial_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 11. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed financial analysis: activation ${pctOfFraction(metrics?.activation_rate)}, retention ${pctOfFraction(metrics?.day_30_retention)}, ${betaRows.length} beta records, runway=${runwayMonths}mo`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Prism completed financial review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score,
      outboundActions,
      agentMessages,
      hypotheses,
    };
  }
}

export default PrismAgent;
