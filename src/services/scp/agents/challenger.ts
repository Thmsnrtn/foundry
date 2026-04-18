// =============================================================================
// FOUNDRY — Challenger Agent (Standalone Function)
// Identifies conflicts and unexamined assumptions across agent positions.
// NOT a BaseAgent subclass — runs on demand during debate orchestration.
// =============================================================================

import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { nanoid } from 'nanoid';

export interface AgentAssertion {
  agentName: string;
  content: string;
  confidence: number;
}

export interface Challenge {
  targetAgent: string;
  assertion: string;
  challengeText: string;
  severity: 'high' | 'medium' | 'low';
}

interface ChallengerResponse {
  challenges: Array<{
    target_agent: string;
    assertion: string;
    challenge_text: string;
    severity: 'high' | 'medium' | 'low';
  }>;
}

/**
 * Run a challenger pass over a set of agent assertions.
 * Identifies the 3 biggest conflicts or unexamined assumptions.
 * Saves challenges to the agent_positions table.
 */
export async function runChallengerPass(
  productId: string,
  debateSessionId: string,
  assertions: AgentAssertion[]
): Promise<Challenge[]> {
  if (assertions.length === 0) return [];

  const assertionLines = assertions
    .map((a, i) => `${i + 1}. [${a.agentName}] (confidence: ${(a.confidence * 100).toFixed(0)}%) "${a.content}"`)
    .join('\n');

  const systemPrompt = `You are a critical analysis engine for a multi-agent intelligence system. Your role is to identify conflicts, contradictions, and unexamined assumptions across positions taken by different specialized agents. Be precise, evidence-based, and focus on the most impactful disagreements.`;

  const userPrompt = `The following are assertions and recommendations from ${assertions.length} specialized business intelligence agents analyzing the same product:

${assertionLines}

Identify the 3 biggest conflicts between these agents OR unexamined assumptions that could invalidate their conclusions. Focus on:
1. Direct contradictions between agent positions
2. Assumptions one agent makes that another implicitly contradicts
3. Critical blind spots or missing data that undermines confidence

Return JSON only (no markdown fences):
{
  "challenges": [
    {
      "target_agent": "agent name whose assertion is being challenged",
      "assertion": "the exact assertion being challenged (brief quote)",
      "challenge_text": "specific challenge explaining why this is wrong, contradicted, or assumes too much (2-3 sentences)",
      "severity": "high" | "medium" | "low"
    }
  ]
}

Return exactly 3 challenges, ordered by severity (highest first).`;

  const response = await callSonnet(systemPrompt, userPrompt, 2048, productId);

  let parsed: ChallengerResponse;
  try {
    parsed = parseJSONResponse<ChallengerResponse>(response.content);
  } catch {
    // Return empty challenges on parse failure — non-fatal
    return [];
  }

  const challenges: Challenge[] = (parsed.challenges ?? []).slice(0, 3).map((c) => ({
    targetAgent: c.target_agent,
    assertion: c.assertion,
    challengeText: c.challenge_text,
    severity: c.severity,
  }));

  // Persist challenges as agent_positions rows
  for (const challenge of challenges) {
    const targetAssertion = assertions.find((a) => a.agentName === challenge.targetAgent);
    const positionId = nanoid();
    await query(
      `INSERT INTO agent_positions
         (id, debate_session_id, agent_name, position_type, content, confidence, accuracy_weight, challenged_by, challenge_response)
       VALUES (?, ?, ?, 'assertion', ?, ?, 1.0, 'challenger', ?)`,
      [
        positionId,
        debateSessionId,
        challenge.targetAgent,
        challenge.assertion,
        targetAssertion?.confidence ?? 0.7,
        challenge.challengeText,
      ]
    );
  }

  return challenges;
}
