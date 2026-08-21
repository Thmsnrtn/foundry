// =============================================================================
// FOUNDRY — Oracle Agent (Analytics Lead)
// Domain: Data analysis, stressor identification, metric interpretation, trends
// Cadence: 24 hours
// Uses Opus (not Sonnet) — the analytical core of the SCP
// v2: Emits hypotheses for data-driven experiments, broadcasts analytical
//     intelligence to the agent network
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentAction,
  AgentMessageSignal, HypothesisSignal,
} from '../types.js';
import { callOpus, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';
import { pctOfFraction, measured, money } from '../../ai/measured.js';

interface OracleClaudeResponse {
  observations: string[];
  stressor_risks: Array<{
    name: string;
    severity: 'critical' | 'elevated' | 'watch';
    signal: string;
    neutralizing_action: string;
    agent_to_notify: string; // which agent should act on this
  }>;
  metric_insights: Array<{
    metric: string;
    trend: 'improving' | 'declining' | 'stable';
    insight: string;
  }>;
  analytical_hypotheses: Array<{
    title: string;
    description: string;
    hypothesis: string;
    success_metric: string;
    success_threshold: number;
    test_duration_days: number;
  }>;
  agent_intel: Array<{
    to_agent: string;
    subject: string;
    insight: string;
    priority: 'critical' | 'high' | 'normal' | 'low';
  }>;
  domain_health_score: number;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class OracleAgent extends BaseAgent {
  getName(): AgentName { return 'oracle'; }
  getRole(): string { return 'Analytics Lead'; }
  getActivationCadenceHours(): number { return 24; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query last 7 metric_snapshots ──────────────────────────────────────
    const metricsResult = await db(
      `SELECT snapshot_date, signups_7d, active_users, new_mrr_cents, churned_mrr_cents,
              expansion_mrr_cents, activation_rate, day_30_retention, churn_rate,
              nps_score, mrr_health_ratio, support_volume_7d
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 7`,
      [productId]
    );

    // ── 2. Query all active stressors ─────────────────────────────────────────
    const stressorResult = await db(
      `SELECT stressor_name, signal, severity, identified_at, neutralizing_action, timeframe_days
       FROM stressor_history
       WHERE product_id = ? AND status = 'active'
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END,
                identified_at DESC`,
      [productId]
    );

    // ── 3. Query signal_history for last 14 days ──────────────────────────────
    const signalHistoryResult = await db(
      `SELECT snapshot_date, score, tier, risk_state, stressor_count
       FROM signal_history
       WHERE product_id = ?
         AND snapshot_date >= date('now', '-14 days')
       ORDER BY snapshot_date DESC`,
      [productId]
    );

    // ── 4. Query recent unreviewed competitive signals ────────────────────────
    const competitiveSignalsResult = await db(
      `SELECT competitor_name, signal_type, signal_summary, significance, detected_at
       FROM competitive_signals
       WHERE product_id = ? AND reviewed = 0
       ORDER BY detected_at DESC
       LIMIT 5`,
      [productId]
    );

    // ── 5. Query running experiments for context ──────────────────────────────
    const experimentsResult = await db(
      `SELECT name AS title, hypothesis, success_metric, status, started_at
       FROM experiments
       WHERE product_id = ? AND status IN ('running', 'completed')
       ORDER BY started_at DESC
       LIMIT 5`,
      [productId]
    );

    // ── 6. Handle no-data case ────────────────────────────────────────────────
    if (metricsResult.rows.length === 0 && stressorResult.rows.length === 0 && signalHistoryResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No analytics data found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting data accumulation',
      };
      return {
        observations: ['No analytics data available yet — Oracle will identify patterns and stressors as metric snapshots and signals accumulate.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Oracle is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
        domainHealthScore: 50,
      };
    }

    // ── 7. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];

    const metricSeries = metricRows.map(row => {
      const date = row.snapshot_date as string;
      // A SERIES IS WHERE THIS MATTERS MOST. Oracle is asked to find trends
      // across these rows, and a column the company stopped reporting used to
      // become a run of zeros — which is not missing data to a model looking
      // for a trend, it is a collapse. See `ai/measured.ts`.
      const signups = measured(row.signups_7d);
      const active = measured(row.active_users);
      const newMrr = money(row.new_mrr_cents);
      const activation = pctOfFraction(row.activation_rate);
      const retention = pctOfFraction(row.day_30_retention);
      const churn = pctOfFraction(row.churn_rate);
      const nps = measured(row.nps_score);
      const healthRatio = measured(row.mrr_health_ratio, 2);
      return `${date}: signups=${signups} active=${active} newMRR=${newMrr} activation=${activation} ret30d=${retention} churn=${churn} nps=${nps} healthRatio=${healthRatio}`;
    }).join('\n');

    const signalRows = signalHistoryResult.rows as Record<string, unknown>[];
    const signalSeries = signalRows.length > 0
      ? signalRows.map(s =>
          `${s.snapshot_date as string}: score=${s.score as number} tier=${s.tier as string} risk=${s.risk_state as string} stressors=${s.stressor_count as number}`
        ).join(' | ')
      : 'No signal history in last 14 days';

    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s =>
          `[${s.severity as string}] ${s.stressor_name as string}: ${s.signal as string} (${s.timeframe_days as number}d — action: ${s.neutralizing_action as string})`
        ).join('; ')
      : 'None active';

    const compSignalRows = competitiveSignalsResult.rows as Record<string, unknown>[];
    const compSignalSummary = compSignalRows.length > 0
      ? compSignalRows.map(s =>
          `${s.competitor_name as string} [${s.signal_type as string}/${s.significance as string}]: ${s.signal_summary as string}`
        ).join('; ')
      : 'None';

    const experimentRows = experimentsResult.rows as Record<string, unknown>[];
    const experimentContext = experimentRows.length > 0
      ? `Running experiments: ${experimentRows.map(e => `${e.title as string} (${e.status as string})`).join(', ')}`
      : 'No active experiments';

    // PostHog/Plausible integration events add behavioral analytics context
    const analyticsEvents = (context.integrationEvents ?? []).filter(
      e => e.source === 'posthog' || e.source === 'plausible'
    );
    const analyticsContext = analyticsEvents.length > 0
      ? `Analytics events: ${analyticsEvents.map(e => e.summary).join(' | ')}`
      : '';

    // ── 8. Call Claude Opus (analytical core) ─────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Oracle, the Chief Analytics Officer for ${companyName}. Your job is not to report data — the CEO can read dashboards. Your job is to find what the data means that the CEO hasn't figured out yet.

You specialize in: non-obvious correlations, leading indicators that predict outcomes 2-4 weeks ahead, and signals that look fine on the surface but mask a structural problem. You have seen hundreds of companies fail — you know what the warning signs look like before they become obvious.

When you see a metric, your first question is not "is this good or bad?" — it's "what will this number cause in 30 days?" You think in causal chains, not snapshots. You flag the specific accounts, cohorts, or experiments driving a trend — not the trend in aggregate.

You are willing to tell the CEO they are wrong. If the data contradicts a recent decision, say so directly.`
    );

    const userPrompt = `Signal trend (14d): ${signalSeries}.

Metric snapshot trend (${metricRows.length} periods, newest first):
${metricSeries || 'No metric data'}

Active stressors (${stressorRows.length}): ${stressorList}.
Unreviewed competitive signals (${compSignalRows.length}): ${compSignalSummary}.
${experimentContext}.${analyticsContext ? `\n${analyticsContext}` : ''}

Analyze comprehensively. Identify trends, patterns, and leading indicators. Flag emerging risks. Route intelligence to relevant agents. Propose data-driven experiments.

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "stressor_risks": [
    {
      "name": "string",
      "severity": "critical" | "elevated" | "watch",
      "signal": "string",
      "neutralizing_action": "string",
      "agent_to_notify": "string (agent name: harbor, forge, beacon, atlas, etc.)"
    }
  ],
  "metric_insights": [
    {
      "metric": "string",
      "trend": "improving" | "declining" | "stable",
      "insight": "string"
    }
  ],
  "analytical_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string",
      "success_threshold": number,
      "test_duration_days": number
    }
  ],
  "agent_intel": [
    {
      "to_agent": "string (agent name or 'broadcast')",
      "subject": "string",
      "insight": "string (2-3 sentences of actionable intelligence)",
      "priority": "critical" | "high" | "normal" | "low"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callOpus(systemPrompt, userPrompt, 4096, context.productId);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = (response.usage.input_tokens ?? 0) * 0.000015 + (response.usage.output_tokens ?? 0) * 0.000075;

    let parsed: OracleClaudeResponse;
    try {
      parsed = parseJSONResponse<OracleClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Oracle encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Oracle experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
        domainHealthScore: 50,
      };
    }

    // ── 9. Build analytical hypotheses ────────────────────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.analytical_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 10. Build agent messages from stressor routing + intel ────────────────
    const agentMessages: AgentMessageSignal[] = [];

    // Route stressor alerts to specific agents
    for (const risk of (parsed.stressor_risks ?? [])) {
      if (risk.severity === 'critical' || risk.severity === 'elevated') {
        const targetAgent = risk.agent_to_notify || 'broadcast';
        agentMessages.push({
          to_agent: targetAgent,
          message_type: 'alert',
          priority: risk.severity === 'critical' ? 'critical' : 'high',
          subject: `[Oracle] Stressor detected: ${risk.name}`,
          body: `Signal: ${risk.signal}\nRecommended action: ${risk.neutralizing_action}`,
        });
      }
    }

    // Add analytical intel messages
    for (const intel of (parsed.agent_intel ?? [])) {
      agentMessages.push({
        to_agent: intel.to_agent,
        message_type: 'insight',
        priority: intel.priority,
        subject: `[Oracle] ${intel.subject}`,
        body: intel.insight,
      });
    }

    // ── 11. Evolution candidates from critical stressors ──────────────────────
    const stressorCritical = (parsed.stressor_risks ?? []).filter(r => r.severity === 'critical');

    // ── 12. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed analytics: ${metricRows.length} metric periods, ${stressorRows.length} active stressors, ${compSignalRows.length} competitive signals, ${hypotheses.length} hypotheses proposed`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions: [],
      briefingContribution: parsed.briefing_contribution ?? 'Oracle completed data analysis.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: stressorCritical.length > 0 ? [{
        trigger: 'critical_stressor_pattern',
        hypothesis: `Critical stressor pattern detected: ${stressorCritical.map(s => s.name).join(', ')}`,
        proposed_change: 'Increase monitoring frequency and alert other agents to critical risks',
        confidence: 0.8,
        evidence: stressorCritical.map(s => `${s.name}: ${s.signal}`),
      }] : [],
      tokensUsed,
      costUsd,
      domainHealthScore: parsed.domain_health_score ?? 50,
      hypotheses,
      agentMessages,
    };
  }
}

export default OracleAgent;
