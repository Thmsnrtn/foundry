// =============================================================================
// FOUNDRY — SCP Evolution Engine
// Manages agent behavioral evolution: founder corrections, self-observations,
// and synthesis of learned behaviors into the agent's constraint set.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import type {
  AgentName,
  AgentInstance,
  EvolutionCandidate,
  EvolutionVersion,
  GoldenSuiteEntry,
} from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function loadAgentInstance(productId: string, agentName: AgentName): Promise<AgentInstance | null> {
  const result = await query(
    'SELECT * FROM agent_instances WHERE product_id=? AND agent_name=?',
    [productId, agentName]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0] as Record<string, unknown>;
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    agent_name: r.agent_name as AgentName,
    display_name: r.display_name as string,
    role_description: r.role_description as string | null,
    version: r.version as number,
    authority_level: r.authority_level as 0 | 1 | 2,
    activation_cadence_hours: r.activation_cadence_hours as number,
    status: r.status as 'active' | 'paused' | 'error',
    total_sessions: r.total_sessions as number,
    successful_sessions: r.successful_sessions as number,
    total_decisions_proposed: r.total_decisions_proposed as number,
    total_decisions_approved: r.total_decisions_approved as number,
    total_evolution_cycles: r.total_evolution_cycles as number,
    domain_health_score: r.domain_health_score as number,
    system_prompt_core: r.system_prompt_core as string | null,
    behavioral_constraints: parseJSON<string[]>(r.behavioral_constraints as string | null, []),
    config_json: parseJSON<Record<string, unknown> | null>(r.config_json as string | null, null),
    last_run_at: r.last_run_at as string | null,
    next_run_at: r.next_run_at as string | null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

async function appendConstraint(
  agentInstanceId: string,
  currentConstraints: string[],
  newConstraint: string
): Promise<string[]> {
  const updated = [...(currentConstraints ?? []), newConstraint];
  await query(
    `UPDATE agent_instances SET behavioral_constraints=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [JSON.stringify(updated), agentInstanceId]
  );
  return updated;
}

// ─── checkEvolutionCandidates ─────────────────────────────────────────────────

export async function checkEvolutionCandidates(
  productId: string,
  agentName: AgentName,
  sessionId: string,
  candidates: EvolutionCandidate[]
): Promise<void> {
  if (candidates.length === 0) return;

  const instance = await loadAgentInstance(productId, agentName);
  if (!instance) return;

  // Load recent golden lessons (last 20 active)
  const lessonsResult = await query(
    `SELECT * FROM golden_suite
     WHERE product_id=? AND agent_name=? AND active=1
     ORDER BY created_at DESC LIMIT 20`,
    [productId, agentName]
  );
  const goldenLessons = lessonsResult.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return r.lesson as string;
  });

  const currentConstraints = instance.behavioral_constraints ?? [];

  for (const candidate of candidates) {
    if (candidate.confidence <= 0.7) continue;

    // Validate via Claude
    let validationResult: { accept: boolean; score: number; notes: string };
    try {
      const systemPrompt =
        'You are an evolution validator for an AI agent system. ' +
        'Evaluate proposed behavioral changes rigorously. Only accept changes that are clear improvements. ' +
        'Return valid JSON only.';

      const userPrompt =
        `Agent: ${agentName} (${instance.display_name})\n\n` +
        `Current behavioral constraints:\n${currentConstraints.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none yet)'}\n\n` +
        `Current golden lessons:\n${goldenLessons.map((l, i) => `${i + 1}. ${l}`).join('\n') || '(none yet)'}\n\n` +
        `Proposed change:\n` +
        `Trigger: ${candidate.trigger}\n` +
        `Hypothesis: ${candidate.hypothesis}\n` +
        `Proposed change: ${candidate.proposed_change}\n` +
        `Confidence: ${candidate.confidence}\n` +
        `Evidence:\n${candidate.evidence.map((e) => `- ${e}`).join('\n')}\n\n` +
        `Evaluate whether this change would genuinely improve the agent's performance ` +
        `without introducing regressions. Return JSON: { "accept": boolean, "score": number (0-1), "notes": string }`;

      const response = await callSonnet(systemPrompt, userPrompt, 512);
      validationResult = parseJSONResponse<{ accept: boolean; score: number; notes: string }>(response.content);
    } catch {
      continue; // Skip on validation error
    }

    if (!validationResult.accept || validationResult.score < 0.75) continue;

    // Create a golden_suite entry as 'self_observation'
    const lessonId = nanoid();
    const lessonText = candidate.proposed_change;

    await query(
      `INSERT INTO golden_suite
         (id, product_id, agent_name, lesson_type, input_context, expected_behavior, lesson, source, confidence, times_reinforced, active)
       VALUES (?, ?, ?, 'behavioral', ?, ?, ?, 'self_observation', ?, 1, 1)`,
      [
        lessonId,
        productId,
        agentName,
        candidate.trigger,
        candidate.hypothesis,
        lessonText,
        candidate.confidence,
      ]
    );

    // Increment golden_suite_size on products
    await query(
      `UPDATE products SET golden_suite_size = golden_suite_size + 1 WHERE id=?`,
      [productId]
    );

    // Create agent_evolution_versions row
    const newVersion = instance.version + 1;
    const previousConfig = {
      behavioral_constraints: currentConstraints,
      version: instance.version,
    };
    const newConfig = {
      behavioral_constraints: [...currentConstraints, lessonText],
      version: newVersion,
      golden_lesson_id: lessonId,
    };

    await query(
      `INSERT INTO agent_evolution_versions
         (id, product_id, agent_name, version, change_type, change_description,
          trigger_session_id, previous_config, new_config, validation_score,
          validation_notes, promoted_at)
       VALUES (?, ?, ?, ?, 'golden_lesson', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        nanoid(),
        productId,
        agentName,
        newVersion,
        `Self-observed: ${candidate.hypothesis.slice(0, 200)}`,
        sessionId,
        JSON.stringify(previousConfig),
        JSON.stringify(newConfig),
        validationResult.score,
        validationResult.notes,
      ]
    );

    // Update behavioral_constraints
    const updated = await appendConstraint(instance.id, currentConstraints, lessonText);
    currentConstraints.length = 0;
    currentConstraints.push(...updated);

    // Bump version
    await query(
      `UPDATE agent_instances SET version=?, total_evolution_cycles=total_evolution_cycles+1, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [newVersion, instance.id]
    );
    await query(
      `UPDATE products SET total_evolution_cycles=total_evolution_cycles+1 WHERE id=?`,
      [productId]
    );
  }
}

// ─── recordFounderCorrection ──────────────────────────────────────────────────

export async function recordFounderCorrection(
  productId: string,
  agentName: AgentName,
  sessionId: string | null,
  originalAction: string,
  correctedAction: string,
  context: string
): Promise<void> {
  const instance = await loadAgentInstance(productId, agentName);
  if (!instance) throw new Error(`Agent instance not found: ${agentName} for product ${productId}`);

  // Synthesize lesson text via Claude
  let lessonText = `When ${context.slice(0, 50)}: prefer "${correctedAction.slice(0, 50)}" over "${originalAction.slice(0, 50)}"`;
  try {
    const systemPrompt =
      'You are a concise lesson synthesizer for an AI agent. ' +
      'Write a single behavioral rule in 25 words or fewer. ' +
      'Be specific and actionable. No fluff.';

    const userPrompt =
      `The founder corrected this agent.\n\n` +
      `Original action: ${originalAction}\n` +
      `Corrected to: ${correctedAction}\n` +
      `Context: ${context}\n\n` +
      `Write a single concise lesson (max 25 words) that captures the rule the agent should follow in the future. ` +
      `Return only the lesson text, nothing else.`;

    const response = await callSonnet(systemPrompt, userPrompt, 100);
    lessonText = response.content.trim().replace(/^["']|["']$/g, '');
  } catch {
    // Use fallback lesson text
  }

  // Insert into golden_suite
  const lessonId = nanoid();
  await query(
    `INSERT INTO golden_suite
       (id, product_id, agent_name, lesson_type, input_context, expected_behavior, lesson, source, confidence, times_reinforced, active)
     VALUES (?, ?, ?, 'correction', ?, ?, ?, 'founder_correction', 1.0, 1, 1)`,
    [
      lessonId,
      productId,
      agentName,
      context,
      correctedAction,
      lessonText,
    ]
  );

  await query(
    `UPDATE products SET golden_suite_size = golden_suite_size + 1 WHERE id=?`,
    [productId]
  );

  // Create agent_evolution_versions entry
  const currentConstraints = instance.behavioral_constraints ?? [];
  const newVersion = instance.version + 1;
  const previousConfig = {
    behavioral_constraints: currentConstraints,
    version: instance.version,
  };
  const newConfig = {
    behavioral_constraints: [...currentConstraints, lessonText],
    version: newVersion,
    founder_correction: {
      original: originalAction,
      corrected: correctedAction,
      context,
    },
  };

  await query(
    `INSERT INTO agent_evolution_versions
       (id, product_id, agent_name, version, change_type, change_description,
        trigger_session_id, previous_config, new_config, validation_score,
        validation_notes, promoted_at)
     VALUES (?, ?, ?, ?, 'founder_correction', ?, ?, ?, ?, 1.0, 'Founder correction — automatically promoted', CURRENT_TIMESTAMP)`,
    [
      nanoid(),
      productId,
      agentName,
      newVersion,
      `Founder correction: ${lessonText.slice(0, 200)}`,
      sessionId,
      JSON.stringify(previousConfig),
      JSON.stringify(newConfig),
    ]
  );

  // Immediately update behavioral_constraints and increment counters
  await appendConstraint(instance.id, currentConstraints, lessonText);
  await query(
    `UPDATE agent_instances SET
       version=?,
       total_evolution_cycles=total_evolution_cycles+1,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [newVersion, instance.id]
  );
  await query(
    `UPDATE products SET total_evolution_cycles=total_evolution_cycles+1 WHERE id=?`,
    [productId]
  );
}

// ─── getEvolutionHistory ──────────────────────────────────────────────────────

export async function getEvolutionHistory(
  productId: string,
  agentName: AgentName
): Promise<EvolutionVersion[]> {
  const result = await query(
    `SELECT * FROM agent_evolution_versions
     WHERE product_id=? AND agent_name=?
     ORDER BY version DESC`,
    [productId, agentName]
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      product_id: r.product_id as string,
      agent_name: r.agent_name as AgentName,
      version: r.version as number,
      change_type: r.change_type as EvolutionVersion['change_type'],
      change_description: r.change_description as string,
      trigger_session_id: r.trigger_session_id as string | null,
      previous_config: parseJSON<Record<string, unknown> | null>(r.previous_config as string | null, null),
      new_config: parseJSON<Record<string, unknown>>(r.new_config as string, {}),
      validation_score: r.validation_score as number | null,
      validation_notes: r.validation_notes as string | null,
      promoted_at: r.promoted_at as string | null,
      created_at: r.created_at as string,
    };
  });
}

// ─── runEvolutionSynthesis ────────────────────────────────────────────────────

export async function runEvolutionSynthesis(
  productId: string,
  agentName: AgentName
): Promise<{ evolved: boolean; newVersion: number | null; description: string }> {
  // Load last 30 sessions for this agent
  const sessionsResult = await query(
    `SELECT * FROM agent_sessions
     WHERE product_id=? AND agent_name=? AND status='completed'
     ORDER BY started_at DESC LIMIT 30`,
    [productId, agentName]
  );

  if (sessionsResult.rows.length < 5) {
    return {
      evolved: false,
      newVersion: null,
      description: `Not enough sessions for synthesis (${sessionsResult.rows.length}/5 required)`,
    };
  }

  // Load all active golden_suite entries
  const lessonsResult = await query(
    `SELECT * FROM golden_suite WHERE product_id=? AND agent_name=? AND active=1 ORDER BY created_at DESC`,
    [productId, agentName]
  );

  const instance = await loadAgentInstance(productId, agentName);
  if (!instance) {
    return { evolved: false, newVersion: null, description: 'Agent instance not found' };
  }

  const currentConstraints = instance.behavioral_constraints ?? [];
  const goldenLessons = lessonsResult.rows.map((r) => (r as Record<string, unknown>).lesson as string);

  // Build sessions summary
  const sessionsSummary = sessionsResult.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const observations = parseJSON<string[]>(r.observations as string | null, []);
    return `Session ${r.id}: ${r.briefing_priority} priority. Observations: ${observations.slice(0, 2).join('; ')}`;
  }).join('\n');

  // Call Claude for synthesis
  let improvements: Array<{ constraint: string; rationale: string; confidence: number }> = [];
  let synthesisNotes = '';

  try {
    const systemPrompt =
      'You are an expert AI agent optimizer. Analyze agent session data and identify concrete behavioral improvements. ' +
      'Be specific and evidence-based. Return valid JSON only.';

    const userPrompt =
      `Agent: ${agentName}\n\n` +
      `Recent sessions (${sessionsResult.rows.length}):\n${sessionsSummary}\n\n` +
      `Current behavioral constraints:\n${currentConstraints.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none)'}\n\n` +
      `Active golden lessons:\n${goldenLessons.map((l, i) => `${i + 1}. ${l}`).join('\n') || '(none)'}\n\n` +
      `Review these agent sessions and golden lessons. Identify 1-3 improvements to the agent's behavioral constraints that would improve success rate. ` +
      `Return JSON: { "improvements": [{ "constraint": string, "rationale": string, "confidence": number }], "synthesis_notes": string }`;

    const response = await callSonnet(systemPrompt, userPrompt, 1024);
    const parsed = parseJSONResponse<{
      improvements: Array<{ constraint: string; rationale: string; confidence: number }>;
      synthesis_notes: string;
    }>(response.content);
    improvements = parsed.improvements ?? [];
    synthesisNotes = parsed.synthesis_notes ?? '';
  } catch {
    return { evolved: false, newVersion: null, description: 'Evolution synthesis failed during Claude call' };
  }

  let evolved = false;
  let latestVersion = instance.version;

  for (const improvement of improvements) {
    if (improvement.confidence < 0.8) continue;

    // Add to golden_suite
    const lessonId = nanoid();
    await query(
      `INSERT INTO golden_suite
         (id, product_id, agent_name, lesson_type, input_context, expected_behavior, lesson, source, confidence, times_reinforced, active)
       VALUES (?, ?, ?, 'behavioral', 'Evolution synthesis', ?, ?, 'evolution_synthesis', ?, 1, 1)`,
      [
        lessonId,
        productId,
        agentName,
        improvement.rationale,
        improvement.constraint,
        improvement.confidence,
      ]
    );

    await query(
      `UPDATE products SET golden_suite_size = golden_suite_size + 1 WHERE id=?`,
      [productId]
    );

    // Update constraints
    const newVersion = latestVersion + 1;
    const previousConfig = {
      behavioral_constraints: [...currentConstraints],
      version: latestVersion,
    };
    currentConstraints.push(improvement.constraint);
    const newConfig = {
      behavioral_constraints: [...currentConstraints],
      version: newVersion,
      synthesis_notes: synthesisNotes,
    };

    await query(
      `INSERT INTO agent_evolution_versions
         (id, product_id, agent_name, version, change_type, change_description,
          trigger_session_id, previous_config, new_config, validation_score, validation_notes, promoted_at)
       VALUES (?, ?, ?, ?, 'constraint_added', ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        nanoid(),
        productId,
        agentName,
        newVersion,
        `Synthesis: ${improvement.constraint.slice(0, 200)}`,
        JSON.stringify(previousConfig),
        JSON.stringify(newConfig),
        improvement.confidence,
        improvement.rationale,
      ]
    );

    await query(
      `UPDATE agent_instances SET
         behavioral_constraints=?,
         version=?,
         total_evolution_cycles=total_evolution_cycles+1,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [JSON.stringify(currentConstraints), newVersion, instance.id]
    );

    await query(
      `UPDATE products SET total_evolution_cycles=total_evolution_cycles+1 WHERE id=?`,
      [productId]
    );

    latestVersion = newVersion;
    evolved = true;
  }

  return {
    evolved,
    newVersion: evolved ? latestVersion : null,
    description: evolved
      ? `Evolved to v${latestVersion}: ${synthesisNotes.slice(0, 200)}`
      : `No improvements met confidence threshold (0.8). Notes: ${synthesisNotes.slice(0, 200)}`,
  };
}
