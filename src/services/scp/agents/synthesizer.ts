// =============================================================================
// FOUNDRY — Synthesizer Agent (Standalone Function)
// Produces a single unified synthesis from agent assertions + challenges.
// NOT a BaseAgent subclass — runs on demand during debate orchestration.
// =============================================================================

import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import type { AgentAssertion, Challenge } from './challenger.js';

export interface SynthesisOutput {
  executiveSummary: string; // 2-sentence unified position
  keyConflicts: Array<{ description: string; resolution: string }>;
  confidenceWeightedRecommendations: Array<{
    recommendation: string;
    supportingAgents: string[];
    weight: number;
  }>;
  dissenting_view: string | null; // strongest minority position worth surfacing
}

interface SynthesizerResponse {
  executive_summary: string;
  key_conflicts: Array<{ description: string; resolution: string }>;
  confidence_weighted_recommendations: Array<{
    recommendation: string;
    supporting_agents: string[];
    weight: number;
  }>;
  dissenting_view: string | null;
}

/**
 * Run a synthesizer pass to produce a unified brief addition.
 * Weighs assertions by agent accuracy scores, surfaces key conflicts and resolutions.
 */
export async function runSynthesizerPass(
  productId: string,
  debateSessionId: string,
  assertions: AgentAssertion[],
  challenges: Challenge[],
  accuracyWeights: Record<string, number>
): Promise<SynthesisOutput> {
  // Suppress unused parameter warnings — available for future use
  void productId;
  void debateSessionId;

  const assertionLines = assertions
    .map((a) => {
      const weight = accuracyWeights[a.agentName] ?? 1.0;
      return `[${a.agentName}] weight=${weight.toFixed(2)} confidence=${(a.confidence * 100).toFixed(0)}%: "${a.content}"`;
    })
    .join('\n');

  const challengeLines = challenges.length > 0
    ? challenges
        .map((c) => `[${c.severity.toUpperCase()}] Challenge to ${c.targetAgent}: "${c.assertion}" — ${c.challengeText}`)
        .join('\n')
    : 'No challenges raised.';

  const weightedAgentList = Object.entries(accuracyWeights)
    .sort(([, a], [, b]) => b - a)
    .map(([name, w]) => `${name}: ${w.toFixed(2)}`)
    .join(', ');

  const systemPrompt = `You are a senior intelligence synthesis engine. You receive assertions from multiple specialized agents (each weighted by historical accuracy) along with adversarial challenges to those assertions. Your task is to produce a single, calibrated, conflict-aware synthesis that a CEO can act on.`;

  const userPrompt = `Product intelligence synthesis request.

AGENT ACCURACY WEIGHTS (higher = more historically accurate):
${weightedAgentList || 'No weights available — treating all agents equally.'}

AGENT ASSERTIONS (${assertions.length} total):
${assertionLines || 'No assertions provided.'}

ADVERSARIAL CHALLENGES (${challenges.length} total):
${challengeLines}

Synthesize these into a unified brief addition. Weight high-accuracy agents more heavily. Surface unresolved conflicts. Identify the strongest minority position if one exists.

Return JSON only (no markdown fences):
{
  "executive_summary": "Exactly 2 sentences. First: the unified consensus position. Second: the most important caveat or uncertainty.",
  "key_conflicts": [
    {
      "description": "Describe the conflict between agents in 1 sentence",
      "resolution": "How to resolve it or why one position is more credible"
    }
  ],
  "confidence_weighted_recommendations": [
    {
      "recommendation": "A specific, actionable recommendation",
      "supporting_agents": ["agent1", "agent2"],
      "weight": 0.0 to 1.0 weighted by agent accuracy and agreement
    }
  ],
  "dissenting_view": "The strongest minority position worth surfacing, or null if none"
}

Include up to 3 key_conflicts and up to 5 confidence_weighted_recommendations, ordered by weight descending.`;

  const response = await callSonnet(systemPrompt, userPrompt, 2048, productId);

  let parsed: SynthesizerResponse;
  try {
    parsed = parseJSONResponse<SynthesizerResponse>(response.content);
  } catch {
    // Return a minimal fallback synthesis on parse failure
    return {
      executiveSummary: 'Agent synthesis encountered a parsing error. Manual review of agent positions is recommended.',
      keyConflicts: [],
      confidenceWeightedRecommendations: [],
      dissenting_view: null,
    };
  }

  return {
    executiveSummary: parsed.executive_summary ?? '',
    keyConflicts: (parsed.key_conflicts ?? []).slice(0, 3),
    confidenceWeightedRecommendations: (parsed.confidence_weighted_recommendations ?? [])
      .slice(0, 5)
      .map((r) => ({
        recommendation: r.recommendation,
        supportingAgents: r.supporting_agents ?? [],
        weight: r.weight ?? 0.5,
      })),
    dissenting_view: parsed.dissenting_view ?? null,
  };
}
