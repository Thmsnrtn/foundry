// =============================================================================
// FOUNDRY — Scribe Agent (Content Director)
// Domain: Blog posts, documentation, case studies, SEO content
// Cadence: 168 hours (weekly)
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type { AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction } from '../types.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { query } from '../../../db/client.js';

interface ScribeClaudeResponse {
  observations: string[];
  content_briefs: Array<{
    type: 'blog_post' | 'case_study' | 'doc' | 'social';
    title: string;
    hook: string;
    key_points: string[];
  }>;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class ScribeAgent extends BaseAgent {
  getName(): AgentName { return 'scribe'; }
  getRole(): string { return 'Content Director'; }
  getActivationCadenceHours(): number { return 168; }

  protected async analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult> {
    const { productId, companyName } = context;

    // ── 1. Query published founding story artifacts ────────────────────────────
    const artifactsResult = await db(
      `SELECT phase, artifact_type, title, created_at
       FROM founding_story_artifacts
       WHERE product_id = ? AND published = 1
       ORDER BY created_at DESC
       LIMIT 5`,
      [productId]
    );

    // ── 2. Query beta testimonials ────────────────────────────────────────────
    const testimonialsResult = await db(
      `SELECT testimonial_text, participant_name
       FROM beta_intake
       WHERE product_id = ? AND testimonial_permitted = 1 AND testimonial_text IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [productId]
    );

    // ── 3. Query product_dna ──────────────────────────────────────────────────
    const dnaResult = await db(
      `SELECT market_insight, positioning_statement, voice_principles, icp_description
       FROM product_dna
       WHERE product_id = ?`,
      [productId]
    );

    // ── 4. Handle no-data case ────────────────────────────────────────────────
    if (artifactsResult.rows.length === 0 && testimonialsResult.rows.length === 0 && dnaResult.rows.length === 0) {
      const action: AgentAction = {
        id: nanoid(),
        type: 'analysis_complete',
        description: 'No content assets or product DNA found — calibrating',
        authority_level: 0,
        executed: true,
        executed_at: new Date().toISOString(),
        result: 'Awaiting product DNA and content assets',
      };
      return {
        observations: ['No content data available yet — Scribe will generate briefs once product DNA and story artifacts are populated.'],
        actionsTaken: [action],
        pendingDecisions: [],
        briefingContribution: 'Scribe is calibrating — no significant activity to report.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // ── 5. Build prompt data ──────────────────────────────────────────────────
    const artifactRows = artifactsResult.rows as Record<string, unknown>[];
    const artifactCount = artifactRows.length;
    const artifactSummary = artifactRows.length > 0
      ? artifactRows.map(a => `[${a.phase as string}] ${a.artifact_type as string}: ${a.title as string}`).join(', ')
      : 'None';

    const testimonialRows = testimonialsResult.rows as Record<string, unknown>[];
    const testimonialCount = testimonialRows.length;
    const testimonialSamples = testimonialRows.length > 0
      ? testimonialRows.slice(0, 3).map(t =>
          `"${(t.testimonial_text as string).slice(0, 150)}"`
        ).join(' | ')
      : 'No testimonials available';

    const dna = dnaResult.rows.length > 0
      ? (dnaResult.rows[0] as Record<string, unknown>)
      : null;
    const marketInsight = dna ? ((dna.market_insight as string) ?? 'Not defined') : 'Not defined';
    const positioning = dna ? ((dna.positioning_statement as string) ?? 'Not defined') : 'Not defined';
    const voicePrinciples = dna ? ((dna.voice_principles as string) ?? 'Not defined') : 'Not defined';
    const icp = dna ? ((dna.icp_description as string) ?? 'Not defined') : 'Not defined';

    // ── 6. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Scribe, the Content Director for ${companyName}. You identify content opportunities and draft briefs for approval. Your content must be grounded in genuine customer insight and the company's unique market position.`
    );

    const userPrompt = `Published artifacts: ${artifactCount}. Available testimonials: ${testimonialCount}.
Market insight: ${marketInsight}.
Positioning: ${positioning}.
ICP: ${icp}.
Voice principles: ${voicePrinciples}.
Testimonial samples: ${testimonialSamples}.
Published artifact summary: ${artifactSummary}.

Generate 2-4 high-value content briefs that will drive ICP acquisition and credibility.
Return JSON only (no markdown fences):
{
  "observations": ["string", ...],
  "content_briefs": [
    {
      "type": "blog_post" | "case_study" | "doc" | "social",
      "title": "string",
      "hook": "string",
      "key_points": ["string", ...]
    }
  ],
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    const costUsd = tokensUsed * 0.000003;

    let parsed: ScribeClaudeResponse;
    try {
      parsed = parseJSONResponse<ScribeClaudeResponse>(response.content);
    } catch {
      return {
        observations: ['Scribe encountered a parsing error — will retry next cycle.'],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: 'Scribe experienced a temporary error during analysis.',
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed,
        costUsd,
      };
    }

    // ── 7. Build decisions for each content brief (authority_level=1) ─────────
    const pendingDecisions: AgentDecision[] = [];
    for (const brief of (parsed.content_briefs ?? [])) {
      const decision: AgentDecision = {
        id: nanoid(),
        agent_name: this.getName(),
        title: `Content Brief: ${brief.title}`,
        description: `${brief.type.toUpperCase()}: ${brief.hook}. Key points: ${brief.key_points.join('; ')}`,
        rationale: `Scribe (Content Director) identified a content opportunity: ${brief.hook}`,
        expected_impact: 'Drives ICP acquisition through organic search and thought leadership.',
        action_type: `content_${brief.type}`,
        action_data: { raw_action: brief },
        expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };
      pendingDecisions.push(decision);
    }

    // ── 8. Record analysis action ─────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed content analysis: ${artifactCount} published artifacts, ${testimonialCount} testimonials, ${pendingDecisions.length} briefs generated`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Scribe completed weekly content review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
    };
  }
}

export default ScribeAgent;
