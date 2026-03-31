// =============================================================================
// FOUNDRY — Oracle Agent (Analytics Lead)
// Domain: Data analysis, stressor identification, metric interpretation, trends
// Cadence: 24 hours
// Uses Opus (not Sonnet) — the analytical core of the SCP
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callOpus, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface OracleClaudeResponse {
  observations: string[];
  stressor_risks: Array<{
    name: string;
    severity: 'critical' | 'elevated' | 'watch';
    signal: string;
    neutralizing_action: string;
  }>;
  metric_insights: Array<{
    metric: string;
    trend: 'improving' | 'declining' | 'stable';
    insight: string;
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

    // ── 5. Handle no-data case ────────────────────────────────────────────────
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

    // ── 6. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];

    // Build metric series (newest to oldest)
    const metricSeries = metricRows.map(row => {
      const date = row.snapshot_date as string;
      const signups = Number(row.signups_7d) || 0;
      const active = Number(row.active_users) || 0;
      const newMrr = (Number(row.new_mrr_cents) || 0) / 100;
      const activation = ((Number(row.activation_rate) || 0) * 100).toFixed(1);
      const retention = ((Number(row.day_30_retention) || 0) * 100).toFixed(1);
      const churn = ((Number(row.churn_rate) || 0) * 100).toFixed(1);
      const nps = Number(row.nps_score) || 0;
      const healthRatio = Number(row.mrr_health_ratio) || 0;
      return `${date}: signups=${signups} active=${active} newMRR=$${newMrr.toFixed(2)} activation=${activation}% ret30d=${retention}% churn=${churn}% nps=${nps} healthRatio=${healthRatio.toFixed(2)}`;
    }).join('\n');

    // Build signal series
    const signalRows = signalHistoryResult.rows as Record<string, unknown>[];
    const signalSeries = signalRows.length > 0
      ? signalRows.map(s =>
          `${s.snapshot_date as string}: score=${s.score as number} tier=${s.tier as string} risk=${s.risk_state as string} stressors=${s.stressor_count as number}`
        ).join(' | ')
      : 'No signal history in last 14 days';

    // Active stressors
    const stressorRows = stressorResult.rows as Record<string, unknown>[];
    const stressorList = stressorRows.length > 0
      ? stressorRows.map(s =>
          `[${s.severity as string}] ${s.stressor_name as string}: ${s.signal as string} (${s.timeframe_days as number}d — action: ${s.neutralizing_action as string})`
        ).join('; ')
      : 'None active';

    // Competitive signals
    const compSignalRows = competitiveSignalsResult.rows as Record<string, unknown>[];
    const compSignalCount = compSignalRows.length;
    const compSignalSummary = compSignalRows.length > 0
      ? compSignalRows.map(s =>
          `${s.competitor_name as string} [${s.signal_type as string}/${s.significance as string}]: ${s.signal_summary as string}`
        ).join('; ')
      : 'None';

    // ── 7. Call Claude Opus (analytical core) ─────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Oracle, the Analytics Lead for ${companyName}. You identify patterns in data, surface stressors, and provide strategic intelligence. Be analytical and precise. Cite specific numbers when drawing conclusions. Identify non-obvious correlations and leading indicators.`
    );

    const userPrompt = `Signal trend (14d): ${signalSeries}.

Metric snapshot trend (${metricRows.length} periods, newest first):
${metricSeries || 'No metric data'}

Active stressors (${stressorRows.length}): ${stressorList}.
Unreviewed competitive signals (${compSignalCount}): ${compSignalSummary}.

Analyze comprehensively. Identify trends, patterns, and leading indicators. Flag emerging risks before they become stressors.
Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "stressor_risks": [
    {
      "name": "string",
      "severity": "critical" | "elevated" | "watch",
      "signal": "string",
      "neutralizing_action": "string"
    }
  ],
  "metric_insights": [
    {
      "metric": "string",
      "trend": "improving" | "declining" | "stable",
      "insight": "string"
    }
  ],
  "domain_health_score": number (0-100),
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callOpus(systemPrompt, userPrompt, 4096);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    // Opus pricing is ~3x Sonnet
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

    // ── 8. Oracle is fully autonomous (authority level 0) — no decisions ──────
    // It surfaces intelligence for other agents and the briefing.
    // Log emerging stressors as evolution candidates if high confidence
    const stressorCritical = (parsed.stressor_risks ?? []).filter(r => r.severity === 'critical');

    // ── 9. Record analysis action ─────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed analytics: ${metricRows.length} metric periods, ${stressorRows.length} active stressors, ${compSignalCount} competitive signals`,
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
    };
  }
}

export default OracleAgent;
