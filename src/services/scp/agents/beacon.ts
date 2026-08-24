// =============================================================================
// FOUNDRY — Beacon Agent (CMO)
// Domain: Marketing, acquisition, brand, positioning experiments
// Cadence: 24 hours
// v2: Emits outboundActions for marketing campaigns, hypotheses for
//     acquisition experiments, agentMessages to harbor on ICP quality
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

interface BeaconClaudeResponse {
  observations: string[];
  marketing_actions: Array<{
    type: 'content' | 'positioning' | 'channel' | 'experiment' | 'campaign';
    title: string;
    description: string;
    estimated_impact: string;
    authority_level: 0 | 1 | 2;
    action_type?: string;
    estimated_cac_usd?: number;
  }>;
  acquisition_hypotheses: Array<{
    title: string;
    description: string;
    hypothesis: string;
    success_metric: string;
    success_threshold: number;
    test_duration_days: number;
  }>;
  icp_fit_assessment: {
    quality: 'strong' | 'moderate' | 'weak';
    signal: string;
    recommended_adjustment?: string;
  };
  domain_health_score?: number;
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
      `SELECT signups_7d, active_users, activation_rate, snapshot_date
       FROM metric_snapshots
       WHERE product_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 3`,
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

    // ── 5. Query cohort acquisition channel performance ───────────────────────
    const cohortChannelResult = await db(
      // RANKED BY A NUMBER NOBODY WRITES. `activated_count` has no writer in
      // this codebase and carried a `DEFAULT 0` until migration 212, so every
      // channel's activation rate was 0 and `ORDER BY avg_activation DESC`
      // returned eight channels in storage order under the heading of a
      // ranking. It is NULL now — SQL sorts NULLs first ascending, so the
      // order names the channels that HAVE a rate before those that do not,
      // and the size of the channel breaks the tie between the unmeasured.
      `SELECT acquisition_channel,
              COUNT(*) as cohort_count,
              SUM(founder_count) as total_users,
              AVG(CAST(activated_count AS REAL) / NULLIF(founder_count, 0)) as avg_activation
       FROM cohorts
       WHERE product_id = ?
       GROUP BY acquisition_channel
       ORDER BY avg_activation IS NULL, avg_activation DESC, total_users DESC
       LIMIT 8`,
      [productId]
    );

    // ── 6. Handle no-data case ────────────────────────────────────────────────
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
      };
    }

    // ── 7. Build prompt data ──────────────────────────────────────────────────
    const metricRows = metricsResult.rows as Record<string, unknown>[];
    const latest = metricRows[0] ?? {};
    // `|| 0` here reported a company that has never sent a metric snapshot as a
    // company with zero signups, zero active users and a 0.0% activation rate —
    // three findings, to a model asked to judge acquisition quality. Counts and
    // rates say `unknown` when nothing was reported. See `ai/measured.ts`.
    const signups = measured(latest.signups_7d);
    const activeUsers = measured(latest.active_users);

    // Signup trend
    const signupTrend = metricRows.length > 1
      ? metricRows.map(r => `${r.snapshot_date as string}: ${measured(r.signups_7d)} signups`).join(' | ')
      : `${signups} signups (7d)`;

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
    const recentSignals = signalRows.length > 0
      ? signalRows.slice(0, 3).map(s =>
          `${s.competitor_name as string}: ${s.signal_type as string} — ${s.signal_summary as string}`
        ).join(' | ')
      : '';

    const channelRows = cohortChannelResult.rows as Record<string, unknown>[];
    const channelPerf = channelRows.length > 0
      ? channelRows.map(r =>
          `${r.acquisition_channel as string}: ${r.total_users as number} users, ${pctOfFraction(r.avg_activation)} activation`
        ).join(' | ')
      : 'No channel data';

    // Analytics events (PostHog shows funnel behavior)
    const analyticsEvents = (context.integrationEvents ?? []).filter(
      e => e.source === 'posthog' || e.source === 'plausible'
    );
    const analyticsContext = analyticsEvents.length > 0
      ? `Behavioral signals: ${analyticsEvents.map(e => e.summary).join(' | ')}`
      : '';

    // ── 8. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Beacon, the Chief Marketing Officer for ${companyName}. You have one question: where is the highest-quality customer acquisition coming from, and how do we get more of it?

You are deeply skeptical of vanity metrics. You care about: ICP match rate of new signups, time-to-value of cohorts by acquisition channel, and CAC payback period by channel. You do not celebrate traffic or signups — you celebrate signups that activate and retain.

You are direct about positioning failures. If the current marketing is attracting the wrong customers, you name the evidence: "The last 3 channels we invested in are converting at 2-3x lower activation rates than our best channel. We are acquiring customers who don't succeed with the product and then churning them. This is worse than not acquiring them."

You prioritize experiments over campaigns. You size them by expected value: "A $200 LinkedIn experiment targeting [specific job title] in [specific industry] would give us a 90% confidence answer on whether this ICP converts within 3 weeks. This is worth running before we increase budget."

You connect marketing decisions to downstream revenue retention, not just acquisition volume.`
    );

    const userPrompt = `Signup trend: ${signupTrend}. Active users: ${activeUsers}. Activation rate: ${pctOfFraction(latest.activation_rate)}.
Channel performance: ${channelPerf}.
ICP: ${icp}.
Positioning: ${positioning}.
What we are not: ${whatWeAreNot || 'Not specified'}.
Voice principles: ${voicePrinciples || 'Not specified'}.
Key competitors: ${competitorNames}.
Unreviewed competitive signals (${signalRows.length}): ${recentSignals || 'none'}.${analyticsContext ? `\n${analyticsContext}` : ''}

Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "marketing_actions": [
    {
      "type": "content" | "positioning" | "channel" | "experiment" | "campaign",
      "title": "string",
      "description": "string",
      "estimated_impact": "string",
      "authority_level": 0 | 1 | 2,
      "action_type": "string (e.g. publish_blog_post, launch_ad_campaign, update_positioning)",
      "estimated_cac_usd": number (optional, for paid channels)
    }
  ],
  "acquisition_hypotheses": [
    {
      "title": "string",
      "description": "string",
      "hypothesis": "string",
      "success_metric": "string (e.g. signup_rate, activation_rate, cac)",
      "success_threshold": number (e.g. 0.20 = 20% improvement),
      "test_duration_days": number
    }
  ],
  "icp_fit_assessment": {
    "quality": "strong" | "moderate" | "weak",
    "signal": "string (what data supports this assessment)",
    "recommended_adjustment": "string (optional, if quality is weak or moderate)"
  },
  "domain_health_score": number (0-100), OMIT THIS FIELD ENTIRELY if you have no
    evidence to score the domain on — an omitted score is recorded as unknown,
    and a guessed one is recorded as a measurement,
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000, context.productId);
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
      };
    }

    // ── 9. Build decisions for experiments ───────────────────────────────────
    const pendingDecisions: AgentDecision[] = [];
    for (const action of (parsed.marketing_actions ?? [])) {
      if (action.type === 'experiment' || (action.authority_level ?? 2) >= 2) {
        pendingDecisions.push({
          id: nanoid(),
          agent_name: this.getName(),
          title: action.title,
          description: action.description,
          rationale: `Beacon proposed ${action.type}: ${action.description}`,
          expected_impact: action.estimated_impact,
          action_type: `marketing_${action.type}`,
          action_data: { raw_action: action },
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 10. Outbound actions for low-authority marketing tasks ────────────────
    const outboundActions: OutboundActionSignal[] = [];
    for (const action of (parsed.marketing_actions ?? [])) {
      if (action.type === 'content' && (action.authority_level ?? 1) <= 1) {
        outboundActions.push({
          action_type: action.action_type ?? 'publish_content',
          description: action.description,
          parameters: { title: action.title, type: action.type, estimated_impact: action.estimated_impact },
          authority_level: (action.authority_level ?? 1) as 0 | 1 | 2,
        });
      }
    }

    // ── 11. Acquisition experiment hypotheses ─────────────────────────────────
    const hypotheses: HypothesisSignal[] = (parsed.acquisition_hypotheses ?? []).map(h => ({
      title: h.title,
      description: h.description,
      hypothesis: h.hypothesis,
      success_metric: h.success_metric,
      success_threshold: h.success_threshold,
      test_duration_days: h.test_duration_days,
    }));

    // ── 12. Inter-agent messages ──────────────────────────────────────────────
    const agentMessages: AgentMessageSignal[] = [];

    // Notify Harbor if ICP fit is weak (acquisition quality affecting activation)
    const icpFit = parsed.icp_fit_assessment;
    if (icpFit && icpFit.quality !== 'strong') {
      agentMessages.push({
        to_agent: 'harbor',
        message_type: 'insight',
        priority: icpFit.quality === 'weak' ? 'high' : 'normal',
        subject: `ICP fit assessment: ${icpFit.quality} — activation may be impacted`,
        body: `Beacon assessed ICP fit as ${icpFit.quality}. Signal: ${icpFit.signal}. ${icpFit.recommended_adjustment ? `Recommended: ${icpFit.recommended_adjustment}` : ''} This may explain retention patterns Harbor is observing.`,
      });
    }

    // Notify Forge of strong acquisition channels (expansion opportunity)
    const topChannel = channelRows[0];
    const topActivation = topChannel?.avg_activation == null
      ? null : Number(topChannel.avg_activation);
    if (topChannel && topActivation !== null && topActivation > 0.5) {
      agentMessages.push({
        to_agent: 'forge',
        message_type: 'insight',
        priority: 'normal',
        subject: `High-activation channel identified: ${topChannel.acquisition_channel as string} (${pctOfFraction(topChannel.avg_activation, 0)} activation)`,
        body: `Channel '${topChannel.acquisition_channel as string}' drives the highest activation rate (${pctOfFraction(topChannel.avg_activation, 0)}). This segment may have higher LTV — Forge should evaluate expansion pricing for this cohort.`,
      });
    }

    // ── 13. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed marketing analysis: ${signups} signups (7d), ${signalRows.length} unreviewed signals, ${hypotheses.length} experiments proposed, ICP fit: ${icpFit?.quality ?? 'unknown'}`,
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
      domainHealthScore: parsed.domain_health_score,
      outboundActions,
      agentMessages,
      hypotheses,
    };
  }
}

export default BeaconAgent;
