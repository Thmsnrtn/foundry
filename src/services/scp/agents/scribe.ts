// =============================================================================
// FOUNDRY — Scribe Agent (Chief of Staff / Knowledge Management)
// Domain: Docs, meeting notes, playbooks, institutional memory
// Cadence: 168 hours (weekly)
// v2: Emits outboundActions for auto-write docs, agentMessages to harbor/atlas
//     for knowledge gaps, queries agent_wiki_entries table
// =============================================================================

import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import type {
  AgentName, AgentRunContext, AgentAnalysisResult, AgentDecision, AgentAction,
  OutboundActionSignal, AgentMessageSignal,
} from '../types.js';
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
  knowledge_gaps: Array<{
    topic: string;
    priority: 'high' | 'medium' | 'low';
    recommended_action: string;
  }>;
  document_proposals: Array<{
    type: 'playbook' | 'runbook' | 'faq' | 'decision_record';
    title: string;
    outline: string;
    authority_level: 0 | 1 | 2;
  }>;
  wiki_contributions: Array<{
    title: string;
    content: string;
    tags: string[];
  }>;
  briefing_contribution: string;
  briefing_priority: 'high' | 'normal' | 'low';
}

export class ScribeAgent extends BaseAgent {
  getName(): AgentName { return 'scribe'; }
  getRole(): string { return 'Chief of Staff'; }
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

    // ── 4. Query recent wiki entries ──────────────────────────────────────────
    const wikiResult = await db(
      `SELECT title, category FROM agent_wiki_entries WHERE product_id=? ORDER BY created_at DESC LIMIT 5`,
      [productId]
    );

    // ── 5. Handle no-data case ────────────────────────────────────────────────
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

    // ── 6. Build prompt data ──────────────────────────────────────────────────
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

    const wikiRows = wikiResult.rows as Record<string, unknown>[];
    const wikiSummary = wikiRows.length > 0
      ? wikiRows.map(w => `"${w.title as string}" [${w.category as string ?? 'general'}]`).join(', ')
      : 'No wiki entries yet';

    // ── 7. Call Claude Sonnet ─────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(
      context,
      `You are Scribe, the Chief of Staff for ${companyName}. You do not write content — you ensure the company's institutional intelligence is captured, connected, and usable for decision-making.

Your job: identify decisions that were made without the context they needed, find patterns across past decisions and their outcomes, and flag when the company is about to repeat a mistake it already made.

You are the keeper of what the company has learned. When a new situation arises, your question is: "Have we been here before? What happened? What would we do differently?"

You surface the 3 most important things the company knows that aren't written down anywhere — the tribal knowledge that would disappear if a co-founder left tomorrow. You recommend documenting them.

You also track decision quality over time: are decisions being made faster or slower? With more or less data? Are they being revisited at the right intervals? Are there recurring debates that should be resolved once and applied as a standing principle?

You are direct when the company is not learning from its own history.`
    );

    const userPrompt = `Published artifacts: ${artifactCount}. Available testimonials: ${testimonialCount}.
Market insight: ${marketInsight}.
Positioning: ${positioning}.
ICP: ${icp}.
Voice principles: ${voicePrinciples}.
Testimonial samples: ${testimonialSamples}.
Published artifact summary: ${artifactSummary}.
Recent wiki entries: ${wikiSummary}.

Generate 2-4 high-value content briefs and identify knowledge gaps and documentation needs.
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
  "knowledge_gaps": [
    {
      "topic": "string",
      "priority": "high" | "medium" | "low",
      "recommended_action": "string"
    }
  ],
  "document_proposals": [
    {
      "type": "playbook" | "runbook" | "faq" | "decision_record",
      "title": "string",
      "outline": "string",
      "authority_level": 0 | 1 | 2
    }
  ],
  "wiki_contributions": [
    {
      "title": "string",
      "content": "string",
      "tags": ["string", ...]
    }
  ],
  "briefing_contribution": "string (2-3 sentences max)",
  "briefing_priority": "high" | "normal" | "low"
}`;

    const response = await callSonnet(systemPrompt, userPrompt, 3000);
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

    // ── 8. Build decisions for each content brief (authority_level=1) ─────────
    const pendingDecisions: AgentDecision[] = [];
    for (const brief of (parsed.content_briefs ?? [])) {
      const decision: AgentDecision = {
        id: nanoid(),
        agent_name: this.getName(),
        title: `Content Brief: ${brief.title}`,
        description: `${brief.type.toUpperCase()}: ${brief.hook}. Key points: ${brief.key_points.join('; ')}`,
        rationale: `Scribe (Chief of Staff) identified a content opportunity: ${brief.hook}`,
        expected_impact: 'Drives ICP acquisition through organic search and thought leadership.',
        action_type: `content_${brief.type}`,
        action_data: { raw_action: brief },
        expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };
      pendingDecisions.push(decision);
    }

    // ── 9. Build outbound actions from document_proposals (authority_level <= 1) ─
    const outboundActions: OutboundActionSignal[] = [];
    for (const proposal of (parsed.document_proposals ?? [])) {
      if (proposal.authority_level <= 1) {
        outboundActions.push({
          action_type: `write_${proposal.type}`,
          description: `Auto-write ${proposal.type}: ${proposal.title}`,
          parameters: {
            doc_type: proposal.type,
            title: proposal.title,
            outline: proposal.outline,
          },
          authority_level: proposal.authority_level,
        });
      }
    }

    // ── 10. Build agent messages for high-priority knowledge gaps ─────────────
    const agentMessages: AgentMessageSignal[] = [];
    const highPriorityGaps = (parsed.knowledge_gaps ?? []).filter(g => g.priority === 'high');

    for (const gap of highPriorityGaps) {
      const topicLower = gap.topic.toLowerCase();
      // Customer-facing docs gaps → Harbor; technical/code docs gaps → Atlas
      if (
        topicLower.includes('customer') ||
        topicLower.includes('onboarding') ||
        topicLower.includes('support') ||
        topicLower.includes('faq') ||
        topicLower.includes('user')
      ) {
        agentMessages.push({
          to_agent: 'harbor',
          message_type: 'insight',
          priority: 'high',
          subject: `Knowledge gap: customer-facing docs missing — ${gap.topic}`,
          body: `Scribe identified a high-priority customer-facing documentation gap: "${gap.topic}". Recommended action: ${gap.recommended_action}. Harbor should factor this into CS workflows.`,
        });
      } else {
        agentMessages.push({
          to_agent: 'atlas',
          message_type: 'insight',
          priority: 'high',
          subject: `Knowledge gap: technical docs missing — ${gap.topic}`,
          body: `Scribe identified a high-priority technical documentation gap: "${gap.topic}". Recommended action: ${gap.recommended_action}. Atlas should flag this in architecture reviews.`,
        });
      }
    }

    // ── 11. Record analysis action ────────────────────────────────────────────
    const analysisAction: AgentAction = {
      id: nanoid(),
      type: 'analysis_complete',
      description: `Completed knowledge analysis: ${artifactCount} published artifacts, ${testimonialCount} testimonials, ${pendingDecisions.length} briefs, ${highPriorityGaps.length} high-priority gaps`,
      authority_level: 0,
      executed: true,
      executed_at: new Date().toISOString(),
      result: 'Analysis stored in session',
    };

    return {
      observations: parsed.observations ?? [],
      actionsTaken: [analysisAction],
      pendingDecisions,
      briefingContribution: parsed.briefing_contribution ?? 'Scribe completed weekly knowledge review.',
      briefingPriority: parsed.briefing_priority ?? 'normal',
      evolutionCandidates: [],
      tokensUsed,
      costUsd,
      outboundActions,
      agentMessages,
    };
  }
}

export default ScribeAgent;
