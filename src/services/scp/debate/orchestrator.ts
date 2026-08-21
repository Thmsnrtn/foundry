// =============================================================================
// FOUNDRY — Debate Orchestrator
// Ties together the Challenger and Synthesizer to run a full debate cycle
// for a given product and briefing date.
// =============================================================================

import { query } from '../../../db/client.js';
import { nanoid } from 'nanoid';
import { runChallengerPass } from '../agents/challenger.js';
import { runSynthesizerPass } from '../agents/synthesizer.js';
import type { AgentAssertion } from '../agents/challenger.js';
import type { SynthesisOutput } from '../agents/synthesizer.js';

export interface DebateSession {
  id: string;
  product_id: string;
  briefing_date: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  positions_json: string | null;
  conflicts_json: string | null;
  synthesis_json: string | null;
  confidence_weights_json: string | null;
  created_at: string;
  completed_at: string | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a full debate cycle for the given product and briefing date.
 * 1. Creates a debate_sessions row
 * 2. Collects today's completed agent sessions
 * 3. Extracts top assertions from each agent
 * 4. Loads accuracy weights
 * 5. Runs challenger pass (identifies conflicts)
 * 6. Runs synthesizer pass (unified output)
 * 7. Persists results and updates the daily briefing
 *
 * A run that throws, or whose synthesizer comes back with nothing, ends as
 * 'failed' and does not touch the briefing. It used to end as 'complete'.
 */
export async function runDebateForProduct(
  productId: string,
  briefingDate: string
): Promise<void> {
  // 1. Create debate session row
  const debateSessionId = nanoid();
  await query(
    `INSERT INTO debate_sessions (id, product_id, briefing_date, status)
     VALUES (?, ?, ?, 'running')`,
    [debateSessionId, productId, briefingDate]
  );

  try {
    // 2. Query completed agent_sessions for today
    const sessionResult = await query(
      `SELECT agent_name, briefing_contribution, observations, actions_taken
       FROM agent_sessions
       WHERE product_id = ?
         AND status = 'completed'
         AND date(started_at) = ?
       ORDER BY started_at DESC`,
      [productId, briefingDate]
    );

    const sessionRows = sessionResult.rows as Record<string, unknown>[];

    // Deduplicate by agent_name — keep the most recent session per agent
    const seenAgents = new Set<string>();
    const uniqueSessions: Record<string, unknown>[] = [];
    for (const row of sessionRows) {
      const agentName = row.agent_name as string;
      if (!seenAgents.has(agentName)) {
        seenAgents.add(agentName);
        uniqueSessions.push(row);
      }
    }

    // 3. Extract top assertions from each agent's session output
    const assertions: AgentAssertion[] = [];
    for (const row of uniqueSessions) {
      const agentName = row.agent_name as string;
      const briefingContribution = (row.briefing_contribution as string | null) ?? '';
      const observationsRaw = row.observations as string | null;

      let observations: string[] = [];
      try {
        observations = observationsRaw ? (JSON.parse(observationsRaw) as string[]) : [];
      } catch {
        observations = [];
      }

      // Extract top 3 content items per agent: briefing contribution + top 2 observations
      const contents: string[] = [];
      if (briefingContribution.trim().length > 10) {
        contents.push(briefingContribution.trim());
      }
      for (const obs of observations.slice(0, 2)) {
        if (obs.trim().length > 10) {
          contents.push(obs.trim());
        }
      }

      // Add up to 3 assertions per agent
      for (const content of contents.slice(0, 3)) {
        assertions.push({
          agentName,
          content,
          confidence: 0.75, // default confidence; accuracy weight applied separately
        });
      }
    }

    // 4. Load accuracy weights for each agent
    const accuracyResult = await query(
      `SELECT agent_name, AVG(accuracy_rate) as avg_accuracy
       FROM agent_accuracy_scores
       WHERE product_id = ?
       GROUP BY agent_name`,
      [productId]
    );

    const accuracyWeights: Record<string, number> = {};
    for (const row of accuracyResult.rows as Record<string, unknown>[]) {
      const agentName = row.agent_name as string;
      const avgAccuracy = row.avg_accuracy as number | null;
      if (avgAccuracy !== null && avgAccuracy > 0) {
        accuracyWeights[agentName] = avgAccuracy;
      }
    }

    // 5. Update debate session with positions
    //
    // These used to be written twice: here, and as one `agent_positions` row
    // per assertion. Only `positions_json` was ever read. Migration 186 retired
    // the copy.
    await query(
      `UPDATE debate_sessions SET positions_json = ?, confidence_weights_json = ? WHERE id = ?`,
      [
        JSON.stringify(assertions),
        JSON.stringify(accuracyWeights),
        debateSessionId,
      ]
    );

    // 6. Run challenger pass
    const challenges = await runChallengerPass(productId, assertions);

    // Save conflicts to session
    await query(
      `UPDATE debate_sessions SET conflicts_json = ? WHERE id = ?`,
      [JSON.stringify(challenges), debateSessionId]
    );

    // 7. Run synthesizer pass
    const synthesis: SynthesisOutput = await runSynthesizerPass(
      productId,
      assertions,
      challenges,
      accuracyWeights
    );

    // 8. Update debate_sessions with synthesis and record how it ended
    await query(
      `UPDATE debate_sessions
       SET synthesis_json = ?,
           status = ?,
           completed_at = datetime('now')
       WHERE id = ?`,
      [JSON.stringify(synthesis), synthesis.failure_reason ? 'failed' : 'complete', debateSessionId]
    );

    // 9. Upsert synthesis into the daily briefing — only a real one. A failure
    //    notice pasted into the founder's briefing under the heading
    //    "[AGENT SYNTHESIS]" is worse than an absent section.
    if (synthesis.failure_reason === null) {
      await _upsertSynthesisIntoBriefing(productId, briefingDate, synthesis, debateSessionId);
    }
  } catch (err) {
    // Mark session as failed — non-fatal to the broader system. It used to be
    // marked 'complete' here, which the debate page renders as a green
    // "Complete" badge beside a conflict count of zero: indistinguishable from
    // a debate in which the agents agreed.
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE debate_sessions SET status = 'failed', completed_at = datetime('now'),
       synthesis_json = ? WHERE id = ?`,
      [
        JSON.stringify({
          executiveSummary: '', keyConflicts: [], confidenceWeightedRecommendations: [],
          dissenting_view: null, failure_reason: errorMsg,
        }),
        debateSessionId,
      ]
    );
    throw err;
  }
}

/**
 * Get a debate session for a given product and briefing date.
 */
export async function getDebateSession(
  productId: string,
  briefingDate: string
): Promise<DebateSession | null> {
  const result = await query(
    `SELECT * FROM debate_sessions
     WHERE product_id = ? AND briefing_date = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [productId, briefingDate]
  );

  if (result.rows.length === 0) return null;
  return _rowToSession(result.rows[0] as Record<string, unknown>);
}

/**
 * List recent debate sessions for a product.
 */
export async function listDebateSessions(
  productId: string,
  limit: number = 14
): Promise<DebateSession[]> {
  const result = await query(
    `SELECT * FROM debate_sessions
     WHERE product_id = ?
     ORDER BY briefing_date DESC, created_at DESC
     LIMIT ?`,
    [productId, limit]
  );

  return (result.rows as Record<string, unknown>[]).map(_rowToSession);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _rowToSession(r: Record<string, unknown>): DebateSession {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    briefing_date: r.briefing_date as string,
    status: r.status as 'pending' | 'running' | 'complete' | 'failed',
    positions_json: r.positions_json as string | null,
    conflicts_json: r.conflicts_json as string | null,
    synthesis_json: r.synthesis_json as string | null,
    confidence_weights_json: r.confidence_weights_json as string | null,
    created_at: r.created_at as string,
    completed_at: r.completed_at as string | null,
  };
}

async function _upsertSynthesisIntoBriefing(
  productId: string,
  briefingDate: string,
  synthesis: SynthesisOutput,
  debateSessionId: string
): Promise<void> {
  // Try to find the briefing for this date and append/update the synthesis section
  try {
    const briefingResult = await query(
      `SELECT id, synthesis_section FROM daily_briefings
       WHERE product_id = ? AND briefing_date = ?
       LIMIT 1`,
      [productId, briefingDate]
    );

    const synthesisText = [
      `[AGENT SYNTHESIS — Debate Session ${debateSessionId.slice(0, 8)}]`,
      synthesis.executiveSummary,
      synthesis.keyConflicts.length > 0
        ? `Conflicts: ${synthesis.keyConflicts.map((c) => c.description).join(' | ')}`
        : '',
      synthesis.dissenting_view
        ? `Dissenting view: ${synthesis.dissenting_view}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (briefingResult.rows.length > 0) {
      const briefingId = (briefingResult.rows[0] as Record<string, unknown>).id as string;
      await query(
        `UPDATE daily_briefings SET synthesis_section = ?, updated_at = datetime('now') WHERE id = ?`,
        [synthesisText, briefingId]
      );
    }
    // If no briefing exists yet, skip — the synthesis is already stored in debate_sessions
  } catch {
    // Non-fatal — briefing table may not have synthesis_section column yet
  }
}
