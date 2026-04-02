// =============================================================================
// FOUNDRY — Prompt Evolver
// Generates, activates, and tracks prompt mutations that improve agent accuracy.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { createHash } from 'crypto';

export interface PromptMutation {
  agentName: string;
  mutationType: 'emphasis_shift' | 'context_addition' | 'framing_change';
  deltaInstructions: string;
  reasoning: string;
}

// ─── Hash helper ──────────────────────────────────────────────────────────────

function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ─── Generate prompt mutations for underperforming agents ────────────────────

export async function generatePromptMutations(productId: string): Promise<PromptMutation[]> {
  // Find agents with rolling accuracy < 0.6 or calibration_score > 0.3
  const scoresResult = await query(
    `SELECT agent_name,
       AVG(accuracy_rate) as avg_accuracy,
       AVG(calibration_score) as avg_calibration,
       SUM(measured_predictions) as total_measured
     FROM agent_accuracy_scores
     WHERE product_id = ?
     GROUP BY agent_name
     HAVING (avg_accuracy < 0.6 OR avg_calibration > 0.3) AND total_measured >= 3`,
    [productId]
  );

  if (scoresResult.rows.length === 0) return [];

  const mutations: PromptMutation[] = [];

  for (const rawRow of scoresResult.rows) {
    const row = rawRow as Record<string, unknown>;
    const agentName = row.agent_name as string;
    const avgAccuracy = (row.avg_accuracy as number | null) ?? 0;
    const avgCalibration = (row.avg_calibration as number | null) ?? 0;
    const totalMeasured = (row.total_measured as number) ?? 0;

    // Get per-type breakdown for richer context
    const typeBreakdown = await query(
      `SELECT prediction_type, accuracy_rate, calibration_score, measured_predictions
       FROM agent_accuracy_scores
       WHERE product_id = ? AND agent_name = ? AND measured_predictions > 0
       ORDER BY accuracy_rate ASC`,
      [productId, agentName]
    );

    const typeLines = typeBreakdown.rows.map((r) => {
      const t = r as Record<string, unknown>;
      const acc = ((t.accuracy_rate as number | null) ?? 0) * 100;
      const cal = ((t.calibration_score as number | null) ?? 0) * 100;
      return `  - ${t.prediction_type as string}: accuracy=${acc.toFixed(0)}%, calibration_error=${cal.toFixed(0)}pp, n=${t.measured_predictions as number}`;
    }).join('\n');

    const systemPrompt = `You are an AI system optimizer. Your task is to suggest a focused delta instruction (≤200 words) that can be appended to an agent's existing system prompt to improve its prediction accuracy. Respond with JSON only.`;

    const userPrompt = `Agent: ${agentName}
Overall accuracy: ${(avgAccuracy * 100).toFixed(0)}% (target ≥60%)
Calibration error: ${(avgCalibration * 100).toFixed(0)}pp (target ≤30pp, lower is better — 0 = perfectly calibrated)
Total measured predictions: ${totalMeasured}

Accuracy by prediction type:
${typeLines || '  (no per-type data)'}

Based on these accuracy gaps, suggest a single focused delta instruction to append to this agent's system prompt. Choose the mutation type that best fits the gap:
- 'emphasis_shift': when the agent misjudges relative importance of signals
- 'context_addition': when the agent lacks domain-specific grounding
- 'framing_change': when the agent is miscalibrated (over/underconfident)

Return JSON only:
{
  "mutationType": "emphasis_shift" | "context_addition" | "framing_change",
  "deltaInstructions": "string (≤200 words, written as a direct instruction to append to the system prompt)",
  "reasoning": "string (1-2 sentences explaining why this mutation targets the accuracy gap)"
}`;

    try {
      const response = await callSonnet(systemPrompt, userPrompt, 512);
      const parsed = parseJSONResponse<{
        mutationType: 'emphasis_shift' | 'context_addition' | 'framing_change';
        deltaInstructions: string;
        reasoning: string;
      }>(response.content);

      // Validate mutation type
      const validTypes = ['emphasis_shift', 'context_addition', 'framing_change'] as const;
      if (!validTypes.includes(parsed.mutationType)) continue;

      // Persist the generated mutation (inactive by default)
      const id = nanoid();
      const baseHash = hashPrompt(`${productId}:${agentName}`);
      const version = await getNextVersion(productId, agentName);

      await query(
        `INSERT INTO evolved_prompts
           (id, product_id, agent_name, prompt_version, mutation_type, base_prompt_hash,
            delta_instructions, reasoning, predictions_before, accuracy_before, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
        [
          id,
          productId,
          agentName,
          version,
          parsed.mutationType,
          baseHash,
          parsed.deltaInstructions,
          parsed.reasoning,
          totalMeasured,
          avgAccuracy,
        ]
      );

      mutations.push({
        agentName,
        mutationType: parsed.mutationType,
        deltaInstructions: parsed.deltaInstructions,
        reasoning: parsed.reasoning,
      });
    } catch {
      // Skip this agent on parse/API failure
    }
  }

  return mutations;
}

// ─── Helper: get next version number for an agent ────────────────────────────

async function getNextVersion(productId: string, agentName: string): Promise<number> {
  const result = await query(
    `SELECT MAX(prompt_version) as max_v FROM evolved_prompts WHERE product_id = ? AND agent_name = ?`,
    [productId, agentName]
  );
  const maxV = (result.rows[0] as Record<string, unknown>)?.max_v as number | null;
  return (maxV ?? 0) + 1;
}

// ─── Activate a specific mutation ─────────────────────────────────────────────

export async function activateMutation(
  productId: string,
  agentName: string,
  mutationId: string
): Promise<void> {
  // Deactivate any currently active mutation for this agent
  await query(
    `UPDATE evolved_prompts SET is_active = 0 WHERE product_id = ? AND agent_name = ? AND is_active = 1`,
    [productId, agentName]
  );

  // Activate the requested mutation
  await query(
    `UPDATE evolved_prompts
     SET is_active = 1, activated_at = datetime('now')
     WHERE id = ? AND product_id = ? AND agent_name = ?`,
    [mutationId, productId, agentName]
  );
}

// ─── Get active prompt delta for an agent ─────────────────────────────────────

export async function getActivePromptDelta(
  productId: string,
  agentName: string
): Promise<string | null> {
  const result = await query(
    `SELECT delta_instructions FROM evolved_prompts
     WHERE product_id = ? AND agent_name = ? AND is_active = 1
     LIMIT 1`,
    [productId, agentName]
  );
  if (result.rows.length === 0) return null;
  return (result.rows[0] as Record<string, unknown>).delta_instructions as string;
}

// ─── Record mutation outcome (called by daily cron) ───────────────────────────

export async function recordMutationOutcome(productId: string, agentName: string): Promise<void> {
  // Get the active mutation
  const mutResult = await query(
    `SELECT id, activated_at FROM evolved_prompts
     WHERE product_id = ? AND agent_name = ? AND is_active = 1
     LIMIT 1`,
    [productId, agentName]
  );
  if (mutResult.rows.length === 0) return;

  const mutRow = mutResult.rows[0] as Record<string, unknown>;
  const mutationId = mutRow.id as string;
  const activatedAt = mutRow.activated_at as string | null;

  // Only measure if activated long enough ago to have meaningful data
  if (!activatedAt) return;

  // Fetch current accuracy stats accumulated after activation
  const statsResult = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN outcome IS NOT NULL AND outcome != 'unmeasurable' THEN 1 END) as measured,
       AVG(CASE WHEN outcome IS NOT NULL AND outcome != 'unmeasurable' THEN accuracy_score END) as avg_accuracy
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ? AND created_at > ?`,
    [productId, agentName, activatedAt]
  );

  if (statsResult.rows.length === 0) return;

  const stats = statsResult.rows[0] as Record<string, unknown>;
  const predictionsAfter = (stats.total as number) ?? 0;
  const accuracyAfter = (stats.avg_accuracy as number | null) ?? null;

  await query(
    `UPDATE evolved_prompts
     SET predictions_after = ?, accuracy_after = ?
     WHERE id = ?`,
    [predictionsAfter, accuracyAfter, mutationId]
  );
}

// ─── List evolution history for a product ─────────────────────────────────────

export async function listEvolutions(productId: string): Promise<{
  id: string;
  agentName: string;
  currentVersion: number;
  accuracyBefore: number | null;
  accuracyAfter: number | null;
  mutationType: string;
  reasoning: string;
  activatedAt: string | null;
  isActive: boolean;
  deltaInstructions: string;
}[]> {
  const result = await query(
    `SELECT id, agent_name, prompt_version, accuracy_before, accuracy_after,
            mutation_type, reasoning, activated_at, is_active, delta_instructions
     FROM evolved_prompts
     WHERE product_id = ?
     ORDER BY agent_name, prompt_version DESC`,
    [productId]
  );

  return result.rows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    return {
      id: row.id as string,
      agentName: row.agent_name as string,
      currentVersion: row.prompt_version as number,
      accuracyBefore: row.accuracy_before as number | null,
      accuracyAfter: row.accuracy_after as number | null,
      mutationType: row.mutation_type as string,
      reasoning: row.reasoning as string,
      activatedAt: row.activated_at as string | null,
      isActive: (row.is_active as number) === 1,
      deltaInstructions: row.delta_instructions as string,
    };
  });
}
