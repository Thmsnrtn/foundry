// =============================================================================
// FOUNDRY — SCP BaseAgent
// Abstract base class for all 12 Sovereign Company Protocol agents.
// Each agent extends this and implements analyzeAndAct().
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import type {
  AgentName,
  AgentInstance,
  AgentRunContext,
  AgentAnalysisResult,
  AgentSessionOutput,
  GoldenSuiteEntry,
  SCPConstitution,
} from '../types.js';

export abstract class BaseAgent {
  // ─── Abstract interface — must implement in subclasses ────────────────────

  abstract getName(): AgentName;
  abstract getRole(): string;
  abstract getActivationCadenceHours(): number;
  protected abstract analyzeAndAct(
    context: AgentRunContext,
    db: typeof query
  ): Promise<AgentAnalysisResult>;

  // ─── Main run entrypoint ──────────────────────────────────────────────────

  async run(productId: string): Promise<AgentSessionOutput> {
    const startTime = Date.now();
    const agentName = this.getName();

    // 1. Get or create agent instance row
    const agentInstance = await this.getOrCreateInstance(productId);

    // 2. Check if agent should run based on cadence
    if (agentInstance.status === 'paused') {
      return this._buildSkippedOutput(agentName, productId, 'agent is paused', startTime);
    }

    if (agentInstance.next_run_at) {
      const nextRun = new Date(agentInstance.next_run_at).getTime();
      if (nextRun > Date.now()) {
        return this._buildSkippedOutput(agentName, productId, 'not due yet', startTime);
      }
    }

    // 3. Insert a new agent_sessions row with status='running'
    const sessionId = nanoid();
    await query(
      `INSERT INTO agent_sessions (id, product_id, agent_name, agent_version, status, started_at)
       VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)`,
      [sessionId, productId, agentName, agentInstance.version]
    );

    // 4. Fetch company name from products table
    const productResult = await query(
      'SELECT name FROM products WHERE id = ?',
      [productId]
    );
    const companyName = productResult.rows.length > 0
      ? ((productResult.rows[0] as Record<string, unknown>).name as string) ?? 'Unknown Company'
      : 'Unknown Company';

    // 5. Load golden lessons
    const goldenLessons = await this.getGoldenLessons(productId);

    // 6. Load constitution from scp_constitutions table
    let constitution: SCPConstitution | null = null;
    try {
      const constResult = await query(
        'SELECT * FROM scp_constitutions WHERE product_id = ?',
        [productId]
      );
      if (constResult.rows.length > 0) {
        const row = constResult.rows[0] as Record<string, unknown>;
        constitution = {
          id: row.id as string,
          product_id: row.product_id as string,
          version: row.version as number,
          core_values: this._parseJSON<string[]>(row.core_values as string | null, []),
          operating_principles: this._parseJSON<string[]>(row.operating_principles as string | null, []),
          authority_framework: this._parseJSON(row.authority_framework as string | null, {}),
          evolution_policy: this._parseJSON(row.evolution_policy as string | null, {
            enabled: true,
            min_sessions_before_evolution: 5,
            correction_threshold: 0.15,
            auto_promote_on_validation_score: 0.85,
            max_constraints_per_agent: 20,
          }),
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
        } as SCPConstitution;
      }
    } catch {
      // Constitution load failure is non-fatal
    }

    // 7. Build AgentRunContext
    const runDate = new Date().toISOString().slice(0, 10);
    const context: AgentRunContext = {
      productId,
      companyName,
      agentInstance,
      goldenLessons,
      constitution,
      runDate,
    };

    // 8. Call analyzeAndAct — catch errors, mark session failed if throws
    let result: AgentAnalysisResult;
    try {
      result = await this.analyzeAndAct(context, query);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE agent_sessions SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`,
        [errorMessage, sessionId]
      );
      await query(
        `UPDATE agent_instances SET status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [agentInstance.id]
      );
      const durationMs = Date.now() - startTime;
      return {
        sessionId,
        agentName,
        productId,
        success: false,
        durationMs,
        observations: [],
        actionsTaken: [],
        pendingDecisions: [],
        briefingContribution: `${this.getName()} encountered an error: ${errorMessage}`,
        briefingPriority: 'low',
        evolutionCandidates: [],
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    // 9. On success: update session row
    await query(
      `UPDATE agent_sessions SET
         status='completed',
         observations=?,
         actions_taken=?,
         pending_decisions=?,
         briefing_contribution=?,
         briefing_priority=?,
         evolution_candidates=?,
         tokens_used=?,
         cost_usd=?,
         completed_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        JSON.stringify(result.observations),
        JSON.stringify(result.actionsTaken),
        JSON.stringify(result.pendingDecisions),
        result.briefingContribution,
        result.briefingPriority,
        JSON.stringify(result.evolutionCandidates),
        result.tokensUsed,
        0, // cost_usd computed below
        sessionId,
      ]
    );

    // 10. Update agent_instances row
    const nowIso = new Date().toISOString();
    const nextRunIso = new Date(Date.now() + this.getActivationCadenceHours() * 3600 * 1000).toISOString();
    const healthScoreUpdate = result.domainHealthScore !== undefined
      ? ', domain_health_score=?'
      : '';
    const healthScoreParams: unknown[] = result.domainHealthScore !== undefined
      ? [result.domainHealthScore]
      : [];

    await query(
      `UPDATE agent_instances SET
         total_sessions = total_sessions + 1,
         successful_sessions = successful_sessions + 1,
         last_run_at=?,
         next_run_at=?,
         status='active',
         updated_at=CURRENT_TIMESTAMP
         ${healthScoreUpdate}
       WHERE id=?`,
      [nowIso, nextRunIso, ...healthScoreParams, agentInstance.id]
    );

    // 11. Log cost to agent_cost_log
    // Use reported cost if provided; otherwise estimate from tokensUsed (Sonnet output token pricing)
    const costUsd = result.costUsd !== undefined ? result.costUsd : result.tokensUsed * 0.000015;
    if (costUsd > 0 || result.tokensUsed > 0) {
      // Also back-fill cost on session row
      await query(
        `UPDATE agent_sessions SET cost_usd=? WHERE id=?`,
        [costUsd, sessionId]
      );
      await query(
        `INSERT INTO agent_cost_log (id, product_id, agent_name, session_id, tokens_output, cost_usd, action_type, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [nanoid(), productId, agentName, sessionId, result.tokensUsed, costUsd, 'agent_session']
      );
    }

    // 12. Trigger evolution check if there are candidates (fire-and-forget)
    if (result.evolutionCandidates.length > 0) {
      import('../evolution.js').then(({ checkEvolutionCandidates }) => {
        checkEvolutionCandidates(productId, agentName, sessionId, result.evolutionCandidates).catch(() => {
          // Evolution failure is non-fatal
        });
      }).catch(() => {
        // Import failure is non-fatal
      });
    }

    const durationMs = Date.now() - startTime;
    return {
      sessionId,
      agentName,
      productId,
      success: true,
      durationMs,
      observations: result.observations,
      actionsTaken: result.actionsTaken,
      pendingDecisions: result.pendingDecisions,
      briefingContribution: result.briefingContribution,
      briefingPriority: result.briefingPriority,
      evolutionCandidates: result.evolutionCandidates,
      tokensUsed: result.tokensUsed,
      costUsd,
    };
  }

  // ─── Golden Suite helpers ─────────────────────────────────────────────────

  async getGoldenLessons(productId: string): Promise<GoldenSuiteEntry[]> {
    const result = await query(
      `SELECT * FROM golden_suite
       WHERE product_id=? AND agent_name=? AND active=1
       ORDER BY times_reinforced DESC, created_at DESC
       LIMIT 30`,
      [productId, this.getName()]
    );
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        product_id: r.product_id as string,
        agent_name: r.agent_name as AgentName,
        lesson_type: r.lesson_type as GoldenSuiteEntry['lesson_type'],
        input_context: r.input_context as string,
        expected_behavior: r.expected_behavior as string,
        lesson: r.lesson as string,
        source: r.source as GoldenSuiteEntry['source'],
        confidence: r.confidence as number,
        times_reinforced: r.times_reinforced as number,
        active: Boolean(r.active),
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      };
    });
  }

  async addGoldenLesson(
    productId: string,
    lesson: Omit<GoldenSuiteEntry, 'id' | 'created_at' | 'updated_at'>
  ): Promise<void> {
    await query(
      `INSERT INTO golden_suite
         (id, product_id, agent_name, lesson_type, input_context, expected_behavior, lesson, source, confidence, times_reinforced, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        productId,
        lesson.agent_name,
        lesson.lesson_type,
        lesson.input_context,
        lesson.expected_behavior,
        lesson.lesson,
        lesson.source,
        lesson.confidence,
        lesson.times_reinforced,
        lesson.active ? 1 : 0,
      ]
    );

    // Keep products.golden_suite_size updated
    await query(
      `UPDATE products SET golden_suite_size = golden_suite_size + 1 WHERE id=?`,
      [productId]
    );
  }

  // ─── Instance management ──────────────────────────────────────────────────

  async getOrCreateInstance(productId: string): Promise<AgentInstance> {
    const agentName = this.getName();
    const existing = await query(
      'SELECT * FROM agent_instances WHERE product_id=? AND agent_name=?',
      [productId, agentName]
    );

    if (existing.rows.length > 0) {
      return this._rowToAgentInstance(existing.rows[0] as Record<string, unknown>);
    }

    // Create it fresh
    const id = nanoid();
    const cadence = this.getActivationCadenceHours();
    const nextRunAt = new Date(Date.now() + cadence * 3600 * 1000).toISOString();

    await query(
      `INSERT INTO agent_instances
         (id, product_id, agent_name, display_name, version, authority_level,
          activation_cadence_hours, status, total_sessions, successful_sessions,
          total_decisions_proposed, total_decisions_approved, total_evolution_cycles,
          domain_health_score, next_run_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'active', 0, 0, 0, 0, 0, 50, ?)`,
      [
        id,
        productId,
        agentName,
        agentName.charAt(0).toUpperCase() + agentName.slice(1), // display_name
        this._defaultAuthorityLevel(),
        cadence,
        nextRunAt,
      ]
    );

    const created = await query(
      'SELECT * FROM agent_instances WHERE id=?',
      [id]
    );
    return this._rowToAgentInstance(created.rows[0] as Record<string, unknown>);
  }

  // ─── Prompt helpers ───────────────────────────────────────────────────────

  protected buildSystemPrompt(context: AgentRunContext, domainSystemPrompt: string): string {
    const parts: string[] = [domainSystemPrompt];

    const formattedLessons = this.formatGoldenLessons(context.goldenLessons);
    if (formattedLessons) {
      parts.push(formattedLessons);
    }

    if (context.constitution && context.constitution.operating_principles.length > 0) {
      const topPrinciples = context.constitution.operating_principles.slice(0, 3);
      parts.push(
        'OPERATING PRINCIPLES:\n' +
        topPrinciples.map((p, i) => `${i + 1}. ${p}`).join('\n')
      );
    }

    parts.push(`Today's date: ${context.runDate}`);

    return parts.join('\n\n');
  }

  protected formatGoldenLessons(lessons: GoldenSuiteEntry[]): string {
    if (!lessons || lessons.length === 0) return '';
    const lines = lessons.map((l, i) => `${i + 1}. ${l.lesson}`);
    return 'GOLDEN LESSONS (learned behaviors for this company):\n' + lines.join('\n');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _buildSkippedOutput(
    agentName: AgentName,
    productId: string,
    reason: string,
    startTime: number
  ): AgentSessionOutput {
    return {
      sessionId: nanoid(),
      agentName,
      productId,
      success: true,
      durationMs: Date.now() - startTime,
      observations: [],
      actionsTaken: [],
      pendingDecisions: [],
      briefingContribution: '',
      briefingPriority: 'low',
      evolutionCandidates: [],
      tokensUsed: 0,
      costUsd: 0,
    };
  }

  private _rowToAgentInstance(r: Record<string, unknown>): AgentInstance {
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
      behavioral_constraints: this._parseJSON<string[] | null>(r.behavioral_constraints as string | null, null),
      config_json: this._parseJSON<Record<string, unknown> | null>(r.config_json as string | null, null),
      last_run_at: r.last_run_at as string | null,
      next_run_at: r.next_run_at as string | null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    };
  }

  private _parseJSON<T>(value: string | null | undefined, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private _defaultAuthorityLevel(): number {
    // Import DEFAULT_AUTHORITY_LEVELS is circular at runtime; use a map literal here.
    const levels: Record<string, number> = {
      atlas: 2, compass: 2, prism: 2, beacon: 2, scribe: 1,
      forge: 2, harbor: 1, sentinel: 1, ledger: 1, shield: 2,
      oracle: 0, crucible: 1,
    };
    return levels[this.getName()] ?? 2;
  }
}
