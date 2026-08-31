// =============================================================================
// FOUNDRY — SCP Evolution Engine v2
// Manages agent self-improvement through session-based observation,
// 5-gate validation, and adaptive cadence control.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { callSonnet } from '../ai/client.js';
import { nanoid } from 'nanoid';
import { runAllGates } from './gates.js';
import { applyConfigChange, rollbackConfig, isConfigType, type ConfigType } from './agent-config.js';
import { isBlocked, type ChangeCategory } from '../discipline/freeze-periods.js';
import { queueProposal } from '../discipline/proposals-queue.js';
import { logger } from '../logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvolutionSession {
  productId: string;
  agentName: string;
  sessionTranscript: string;
  sessionId?: string;
  isCorrection?: boolean;
}

export interface EvolutionResult {
  evolved: boolean;
  reason: string;
  changes?: EvolutionChange[];
  rolledBack?: boolean;
  sessionId: string;
}

export interface EvolutionChange {
  configType: string;
  approved: boolean;
  rejectedBy?: string;
  rationale: string;
}

interface GoldenLesson {
  lesson: string;
  confidence: number;
}

// ─── Adaptive Cadence ─────────────────────────────────────────────────────────

/**
 * Determine whether to run evolution for this session based on cadence rules.
 */
export function shouldEvolveThisSession(
  totalSessions: number,
  observationsFound: boolean,
  isCorrection: boolean,
  hasMajorEvent: boolean = false
): boolean {
  // Always evolve on corrections — human said something is wrong
  if (isCorrection) return true;

  // Aggressive early on: evolve every session for first 10
  if (totalSessions < 10) return true;

  // Moderate: evolve when observations found (sessions 10-49)
  if (totalSessions < 50) return observationsFound;

  // Conservative: only on corrections or major events with observations
  return isCorrection || (observationsFound && hasMajorEvent);
}

// ─── Session Observation Extraction ──────────────────────────────────────────

interface ObservationResult {
  hasObservations: boolean;
  observations: string[];
  hasMajorEvent: boolean;
  proposedChanges: Array<{
    configType: string;
    content: string;
    rationale: string;
  }>;
}

async function extractObservations(
  session: EvolutionSession
): Promise<ObservationResult> {
  const systemPrompt = `You are an AI agent behavior analyst. Given a session transcript, extract behavioral observations and propose specific config improvements.

Return JSON:
{
  "hasObservations": true/false,
  "hasMajorEvent": true/false,
  "observations": ["observation 1", "observation 2"],
  "proposedChanges": [
    {
      "configType": "domain_knowledge|task_patterns|persona|tool_preferences|error_recovery|shared_knowledge",
      "content": "the full new content for this config section",
      "rationale": "why this change would improve agent performance"
    }
  ]
}

Rules:
- Only propose changes you are highly confident about
- Be conservative: propose minimal, high-signal changes
- configType must be one of the 6 valid types
- hasMajorEvent = true if session revealed a significant new insight or critical failure
- Observations should be specific and actionable`;

  const userPrompt = `Agent: ${session.agentName}
Session Transcript:
${session.sessionTranscript}

What behavioral observations can you extract? What specific config changes would improve this agent's performance?`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 2048, session.productId);
    const content = response.content.trim();

    let cleaned = content;
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

    return JSON.parse(cleaned.trim()) as ObservationResult;
  } catch (err) {
    logger.error('Observation extraction failed', { error: String(err) });
    return {
      hasObservations: false,
      observations: [],
      hasMajorEvent: false,
      proposedChanges: [],
    };
  }
}

// ─── Self-Critique Step ───────────────────────────────────────────────────────

interface CritiqueResult {
  critiques: string[];
  additionalChanges: Array<{
    configType: string;
    content: string;
    rationale: string;
  }>;
}

async function runSelfCritique(
  session: EvolutionSession,
  currentConfig: string,
  initialObservations: ObservationResult
): Promise<CritiqueResult> {
  const systemPrompt = `You are an evolution critic, NOT the agent that ran this session.
Review this session transcript and the agent's current config.
What specific, minimal changes to the config would improve performance?
Be conservative. Propose only high-confidence changes.

Return JSON:
{
  "critiques": ["critique 1", "critique 2"],
  "additionalChanges": [
    {
      "configType": "domain_knowledge|task_patterns|persona|tool_preferences|error_recovery|shared_knowledge",
      "content": "the full new content for this config section",
      "rationale": "why this change would improve agent performance"
    }
  ]
}`;

  const userPrompt = `Agent: ${session.agentName}

Current Config:
${currentConfig}

Session Transcript:
${session.sessionTranscript}

Initial Observations Already Found:
${initialObservations.observations.join('\n')}

As an independent critic: what additional specific, minimal changes would improve this agent's performance?`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 2048, session.productId);
    const content = response.content.trim();

    let cleaned = content;
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

    return JSON.parse(cleaned.trim()) as CritiqueResult;
  } catch (err) {
    logger.error('Self-critique failed', { error: String(err) });
    return { critiques: [], additionalChanges: [] };
  }
}

// ─── Golden Lessons Loader ────────────────────────────────────────────────────

async function loadGoldenLessons(
  productId: string,
  agentName: string
): Promise<string[]> {
  try {
    // Try golden_suite table — may exist from prior SCP implementation
    const result = await query(
      `SELECT lesson FROM golden_suite
       WHERE product_id = ? AND agent_name = ? AND active = 1
       ORDER BY created_at ASC`,
      [productId, agentName]
    );
    return result.rows.map(row => {
      const r = row as Record<string, unknown>;
      return r.lesson as string;
    });
  } catch {
    // Table doesn't exist yet — return empty
    return [];
  }
}

// ─── Success Rate Check for Auto-Rollback ────────────────────────────────────

async function getRecentSuccessRate(
  productId: string,
  agentName: string,
  sessionCount: number = 5
): Promise<number | null> {
  try {
    const result = await query(
      `SELECT outcome FROM audit_log
       WHERE product_id = ? AND action_type LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
      [productId, `%${agentName}%`, sessionCount]
    );

    if (result.rows.length < sessionCount) return null;

    const successCount = result.rows.filter(row => {
      const r = row as Record<string, unknown>;
      const outcome = r.outcome as string | null;
      return outcome === 'success' || outcome === 'completed';
    }).length;

    return successCount / result.rows.length;
  } catch {
    return null;
  }
}

async function getSessionCount(productId: string, agentName: string): Promise<number> {
  try {
    const result = await query(
      `SELECT COUNT(*) as count FROM audit_log
       WHERE product_id = ? AND action_type LIKE ?`,
      [productId, `%${agentName}_evolution%`]
    );
    const row = result.rows[0] as Record<string, unknown>;
    return (row?.count as number) ?? 0;
  } catch {
    return 0;
  }
}

// ─── Architecture Freeze Classifier (V3.1 Layer A) ───────────────────────────

/**
 * Map an evolution config-change to a freeze ChangeCategory.
 *
 * Tightening (always allowed during freeze):
 *   - 'behavioral_constraints' (constraint_added by another name)
 *
 * Correction (always allowed during freeze):
 *   - any change where isCorrection=true (founder is the trigger)
 *
 * Prompt refinement (blocked under architecture_class freeze):
 *   - 'system_prompt', 'system_prompt_core', 'domain_context',
 *     'decision_framework', and any other config type that changes how
 *     the agent thinks
 */
export function classifyEvolutionChange(
  configType: ConfigType,
  isCorrection: boolean
): ChangeCategory {
  // TWO VOCABULARIES THAT SHARE NOT ONE WORD.
  //
  // This used to return 'tightening' for `configType === 'behavioral_constraints'`,
  // and took a `string` so it could. `agent_configs.config_type` permits six
  // values — persona, domain_knowledge, task_patterns, tool_preferences,
  // error_recovery, shared_knowledge — and 'behavioral_constraints' is not one
  // of them, nor were 'system_prompt', 'domain_context' or
  // 'system_prompt_core', which the test exercised. The classifier and the
  // column disagreed about what a config type IS, completely.
  //
  // That mattered because 'tightening' is in the freeze gate's `alwaysAllowed`
  // list. The word arrived from a language model, chose a category the freeze
  // never blocks, and only thirty lines later would the column have refused it
  // — so a freeze could be answered on a value that could not exist.
  //
  // No STORABLE config type is a constraint addition: a type names which part
  // of an agent's configuration changed, never which direction. So the honest
  // mapping over the real six is correction or prompt_refinement, and an
  // evolution config change is no longer exempt from a freeze on the strength
  // of its type name. The parameter is the union now, so the next attempt to
  // classify a word from outside it does not compile.
  return isCorrection ? 'correction' : 'prompt_refinement';
}

// ─── Main Evolution Function ───────────────────────────────────────────────────

/**
 * Run the evolution engine for a single agent session.
 * Extracts observations, critiques, runs 5-gate validation, applies changes.
 */
export async function evolveAgent(session: EvolutionSession): Promise<EvolutionResult> {
  const { productId, agentName, sessionTranscript, isCorrection = false } = session;
  const sessionId = session.sessionId ?? nanoid();

  logger.info(`Starting evolution for ${agentName} (session ${sessionId})`, { agentName, productId });

  // Get session count for adaptive cadence
  const totalSessions = await getSessionCount(productId, agentName);

  // Step 1: Extract observations from the session
  const observations = await extractObservations(session);

  // Step 2: Adaptive cadence check
  const shouldEvolve = shouldEvolveThisSession(
    totalSessions,
    observations.hasObservations,
    isCorrection,
    observations.hasMajorEvent
  );

  if (!shouldEvolve) {
    logger.info(`Skipping evolution for ${agentName} — cadence check`, { agentName, productId });
    return {
      evolved: false,
      reason: `Cadence check: session ${totalSessions}, no observations or major events`,
      sessionId,
    };
  }

  // Step 3: Load golden lessons for regression gate
  const goldenLessons = await loadGoldenLessons(productId, agentName);

  // Step 4: Self-critique step (separate LLM call)
  // Get current config for context
  let currentConfigText = '';
  try {
    const { getAgentConfig } = await import('./agent-config.js');
    const config = await getAgentConfig(productId, agentName);
    currentConfigText = Object.entries(config)
      .map(([k, v]) => `[${k}]\n${v}`)
      .join('\n\n');
  } catch {
    currentConfigText = '(no existing config)';
  }

  const critique = await runSelfCritique(session, currentConfigText, observations);

  // Step 5: Merge initial proposed changes + critique additions (deduplicate by configType)
  const allProposed = [...observations.proposedChanges];
  for (const critiqueChange of critique.additionalChanges) {
    const alreadyProposed = allProposed.find(p => p.configType === critiqueChange.configType);
    if (!alreadyProposed) {
      allProposed.push(critiqueChange);
    }
  }

  if (allProposed.length === 0) {
    return {
      evolved: false,
      reason: 'No config changes proposed after observation + critique',
      sessionId,
    };
  }

  // Step 6: Run 5-gate validation for each proposed change
  const changes: EvolutionChange[] = [];

  for (const proposed of allProposed) {
    const validationResult = await runAllGates({
      productId,
      agentName,
      configType: proposed.configType,
      proposedContent: proposed.content,
      rationale: proposed.rationale,
      goldenLessons,
    });

    if (validationResult.approved) {
      // A WORD THE MODEL CHOSE, ASKED BEFORE IT IS BELIEVED.
      //
      // `proposed.configType` is a language model's answer, and everything
      // below acts on it: it selects a freeze category thirty lines before
      // `agent_configs.config_type` would refuse it. An answer outside the
      // vocabulary bought a decision from the freeze gate and then failed to
      // store, so the control was consulted and answered on a value that could
      // never have existed. Refusing here is the only place that ordering is
      // safe.
      if (!isConfigType(proposed.configType)) {
        logger.warn(
          `${agentName}/${productId}: evolution proposed a config type that is not one — ` +
          `${JSON.stringify(proposed.configType).slice(0, 60)}`);
        continue;
      }

      // V3.1 Layer A: architecture freeze gate.
      // Classify the change and check freeze before applying. Tightening
      // (constraint additions) and founder corrections always pass; other
      // change classes route to phase_beta_proposals when freeze is active.
      const category = classifyEvolutionChange(proposed.configType, isCorrection);
      const freezeCheck = await isBlocked(productId, category);
      if (freezeCheck.blocked) {
        await queueProposal(productId, {
          source_type: 'evolution',
          source_id: sessionId,
          proposed_change: `${agentName}/${proposed.configType}: ${proposed.rationale}`,
          proposed_by: agentName,
          rationale: proposed.rationale,
          blocked_during_freeze_id: freezeCheck.freeze?.id ?? null,
        });
        changes.push({
          configType: proposed.configType,
          approved: false,
          rejectedBy: 'architecture_freeze',
          rationale: `Blocked by architecture freeze; queued to phase_beta_proposals`,
        });
        logger.info(
          `Freeze blocked ${agentName}/${proposed.configType} (${category}); queued`,
          { agentName, productId }
        );
        continue;
      }

      // Apply the change
      const gateScores: Record<string, number> = {};
      for (const gate of validationResult.gates) {
        if (gate.score !== undefined) {
          gateScores[gate.gate] = gate.score;
        }
      }

      await applyConfigChange({
        productId,
        agentName,
        configType: proposed.configType,
        newContent: proposed.content,
        rationale: proposed.rationale,
        sessionId,
        gateScores,
        changedBy: 'evolution_engine',
      });

      changes.push({
        configType: proposed.configType,
        approved: true,
        rationale: proposed.rationale,
      });

      logger.info(`Applied change to ${agentName}/${proposed.configType}`, { agentName, productId });
    } else {
      changes.push({
        configType: proposed.configType,
        approved: false,
        rejectedBy: validationResult.rejected_by,
        rationale: proposed.rationale,
      });

      logger.info(
        `Rejected change to ${agentName}/${proposed.configType} by gate: ${validationResult.rejected_by}`,
        { agentName, productId }
      );
    }
  }

  const evolvedCount = changes.filter(c => c.approved).length;

  // Step 7: Auto-rollback check — if success rate dropped > 10% over last 5 sessions
  let rolledBack = false;
  if (evolvedCount > 0) {
    const successRate = await getRecentSuccessRate(productId, agentName, 5);
    if (successRate !== null && successRate < 0.5) {
      // Success rate is critically low — check if it dropped significantly
      logger.warn(
        `Success rate for ${agentName} is ${(successRate * 100).toFixed(1)}% — initiating rollback check`,
        { agentName, productId }
      );

      // Rollback all approved changes by reverting to previous version
      for (const change of changes.filter(c => c.approved)) {
        try {
          // Get current version to rollback to previous
          const versionResult = await query(
            'SELECT version FROM agent_configs WHERE product_id = ? AND agent_name = ? AND config_type = ?',
            [productId, agentName, change.configType]
          );

          if (versionResult.rows.length > 0) {
            const row = versionResult.rows[0] as Record<string, unknown>;
            const currentVersion = row.version as number;
            if (currentVersion > 1) {
              await rollbackConfig(productId, agentName, change.configType, currentVersion - 1);
              rolledBack = true;
            }
          }
        } catch (err) {
          logger.error(`Rollback failed for ${agentName}/${change.configType}`, { agentName, productId, error: String(err) });
        }
      }

      if (rolledBack) {
        await insertAuditLog({
          id: nanoid(),
          product_id: productId,
          action_type: `${agentName}_evolution_rollback`,
          gate: 1,
          trigger: 'auto_rollback_low_success_rate',
          reasoning: `Auto-rollback triggered: ${agentName} success rate dropped to ${(successRate * 100).toFixed(1)}% over last 5 sessions after evolution.`,
          outcome: 'rolled_back',
        });
      }
    }
  }

  // Step 8: Log the evolution session
  await insertAuditLog({
    id: nanoid(),
    product_id: productId,
    action_type: `${agentName}_evolution`,
    gate: 1,
    trigger: isCorrection ? 'correction' : 'scheduled_evolution',
    reasoning: [
      `Evolution session for ${agentName}.`,
      `Observations: ${observations.observations.length}`,
      `Critique points: ${critique.critiques.length}`,
      `Proposed changes: ${allProposed.length}`,
      `Approved changes: ${evolvedCount}`,
      rolledBack ? 'Auto-rollback applied due to low success rate.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    input_context: JSON.stringify({
      sessionId,
      totalSessions,
      isCorrection,
      hasMajorEvent: observations.hasMajorEvent,
    }),
    output: JSON.stringify(changes),
    outcome: evolvedCount > 0 ? 'evolved' : 'no_change',
  });

  return {
    evolved: evolvedCount > 0,
    reason:
      evolvedCount > 0
        ? `Applied ${evolvedCount} config change(s) for ${agentName}`
        : `All ${allProposed.length} proposed changes rejected by validation gates`,
    changes,
    rolledBack,
    sessionId,
  };
}

/**
 * Validate a proposed evolution change without applying it.
 * Used for previewing what the evolution engine would do.
 */
export async function validateProposedChange(params: {
  productId: string;
  agentName: string;
  configType: string;
  proposedContent: string;
  rationale: string;
}): Promise<ReturnType<typeof runAllGates>> {
  const goldenLessons = await loadGoldenLessons(params.productId, params.agentName);
  return runAllGates({ ...params, goldenLessons });
}

/**
 * Get the evolution history for an agent.
 * Returns the last N evolution audit log entries.
 */
export async function getEvolutionHistory(
  productId: string,
  agentName: string,
  limit: number = 20
): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    `SELECT * FROM audit_log
     WHERE product_id = ? AND action_type LIKE ?
     ORDER BY created_at DESC LIMIT ?`,
    [productId, `${agentName}_evolution%`, limit]
  );
  return result.rows.map(row => row as Record<string, unknown>);
}

// =============================================================================
// BACKWARD COMPATIBILITY SHIMS
// The v2 evolution engine renamed/restructured these functions.
// These shims preserve the original API so callers don't need updating.
// =============================================================================

import type { AgentName, EvolutionCandidate } from './types.js';

/**
 * Build a real session transcript from agent_sessions rows so the evolution
 * engine reasons over what the agent actually observed/did/decided rather than
 * a synthetic one-liner (Phase 2.5). Returns '' when there's nothing to show.
 */
export async function buildRecentSessionsTranscript(
  productId: string,
  agentName: string,
  limit: number,
  specificSessionId?: string,
): Promise<string> {
  const fmt = (v: unknown): string[] => {
    try {
      const arr = JSON.parse(String(v ?? '[]'));
      if (!Array.isArray(arr)) return [];
      return arr.map((el) => (typeof el === 'string' ? el : JSON.stringify(el)));
    } catch {
      return [];
    }
  };
  try {
    const result = specificSessionId
      ? await query(
          `SELECT observations, actions_taken, pending_decisions, briefing_contribution, completed_at
             FROM agent_sessions WHERE id = ?`,
          [specificSessionId],
        )
      : await query(
          `SELECT observations, actions_taken, pending_decisions, briefing_contribution, completed_at
             FROM agent_sessions
            WHERE product_id = ? AND agent_name = ? AND status = 'completed'
            ORDER BY completed_at DESC LIMIT ?`,
          [productId, agentName, limit],
        );
    if (result.rows.length === 0) return '';
    const blocks = result.rows.map((row, i) => {
      const r = row as Record<string, unknown>;
      const obs = fmt(r.observations);
      const acts = fmt(r.actions_taken);
      const decs = fmt(r.pending_decisions);
      const parts = [`--- Session ${i + 1} (${(r.completed_at as string) ?? 'n/a'}) ---`];
      if (obs.length) parts.push('Observations:\n' + obs.map((o) => `- ${o}`).join('\n'));
      if (acts.length) parts.push('Actions taken:\n' + acts.map((a) => `- ${a}`).join('\n'));
      if (decs.length) parts.push('Pending decisions:\n' + decs.map((d) => `- ${d}`).join('\n'));
      if (r.briefing_contribution) parts.push(`Briefing contribution: ${String(r.briefing_contribution)}`);
      return parts.join('\n');
    });
    return blocks.join('\n\n');
  } catch {
    return '';
  }
}

/**
 * @deprecated Use evolveAgent() instead. Kept for backward compatibility.
 * Called from BaseAgent after a session — wraps the new evolution pipeline.
 */
export async function checkEvolutionCandidates(
  productId: string,
  agentName: string,
  sessionId: string,
  candidates: EvolutionCandidate[]
): Promise<void> {
  if (candidates.length === 0) return;
  try {
    const instance = await query(
      'SELECT total_sessions FROM agent_instances WHERE product_id=? AND agent_name=?',
      [productId, agentName]
    );
    if (instance.rows.length === 0) return;
    const row = instance.rows[0] as Record<string, unknown>;
    const totalSessions = (row.total_sessions as number) ?? 0;
    if (!shouldEvolveThisSession(totalSessions, candidates.length > 0, false)) return;

    // Feed the actual session (observations/actions/decisions) plus the
    // candidate hypotheses, not just a synthetic summary line (Phase 2.5).
    const realTranscript = await buildRecentSessionsTranscript(productId, agentName, 1, sessionId);
    const candidateLine = `Evolution candidates this session: ${candidates.map(c => c.hypothesis).join('; ')}`;
    await evolveAgent({
      productId,
      agentName: agentName as AgentName,
      sessionId,
      sessionTranscript: realTranscript ? `${realTranscript}\n\n${candidateLine}` : candidateLine,
      isCorrection: false,
    });
  } catch {
    // Non-fatal
  }
}

/**
 * @deprecated Use evolveAgent() with isCorrection=true instead.
 * Kept for backward compatibility with agents.ts route.
 */
export async function recordFounderCorrection(
  productId: string,
  agentName: string,
  sessionId: string | null,
  originalAction: string,
  correctedAction: string,
  context: string
): Promise<void> {
  try {
    await evolveAgent({
      productId,
      agentName: agentName as AgentName,
      sessionId: sessionId ?? undefined,
      sessionTranscript: `Founder correction in context: ${context}. Original: "${originalAction}". Corrected to: "${correctedAction}".`,
      isCorrection: true,
    });
  } catch {
    // Non-fatal
  }
}

/**
 * @deprecated Use evolveAgent() instead.
 * Kept for backward compatibility with scheduler.ts and agents-evolve route.
 */
export async function runEvolutionSynthesis(
  productId: string,
  agentName: string
): Promise<{ evolved: boolean; newVersion: number | null; description: string }> {
  try {
    // Synthesize over the agent's actual recent sessions, not a synthetic
    // prompt (Phase 2.5). Fall back to the generic instruction only when there
    // are no completed sessions yet.
    const realTranscript = await buildRecentSessionsTranscript(productId, agentName, 5);
    const result = await evolveAgent({
      productId,
      agentName: agentName as AgentName,
      sessionTranscript: realTranscript
        ? `Scheduled evolution synthesis — review these recent sessions and propose improvements:\n\n${realTranscript}`
        : 'Scheduled evolution synthesis — review recent sessions and propose improvements.',
      isCorrection: false,
    });
    const appliedCount = result.changes?.filter(c => c.approved).length ?? 0;
    return {
      evolved: result.evolved,
      newVersion: result.evolved ? appliedCount : null,
      description: result.reason,
    };
  } catch (err) {
    return {
      evolved: false,
      newVersion: null,
      description: `Evolution synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
