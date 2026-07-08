// =============================================================================
// FOUNDRY — SCP BaseAgent v2
// Abstract base class for all 12 Sovereign Company Protocol agents.
// v2 additions: typed config injection, integration event context, inter-agent
// messages, cost P&L logging, and structured v2/v3 signal processing.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { computeCostCents, MODELS } from '../../ai/client.js';
import { sanitizeForPrompt } from '../../ai/sanitize.js';
import { logger } from '../../logger.js';
import type {
  AgentName,
  AgentInstance,
  AgentRunContext,
  AgentAnalysisResult,
  AgentSessionOutput,
  GoldenSuiteEntry,
  SCPConstitution,
  IntegrationEventSummary,
  IncomingAgentMessage,
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

    // 7. Load typed agent config (v2)
    const agentConfig = await this._loadAgentConfig(productId, agentName);

    // 8. Load relevant integration events (v2) — events since last run
    const integrationEvents = await this._loadIntegrationEvents(productId, agentName, agentInstance.last_run_at);

    // 9. Load unread inter-agent messages (v2)
    const unreadMessages = await this._loadUnreadMessages(productId, agentName);

    // 10. Check for pending initiatives (v2)
    await this._processInitiatives(productId, agentName, sessionId);

    // 11. Build AgentRunContext
    const runDate = new Date().toISOString().slice(0, 10);

    // Load what other agents found today (fire-and-forget on failure)
    const { getScratchpadContext } = await import('../coordination/scratchpad.js');
    const scratchpadContext = await getScratchpadContext(productId).catch(() => '');

    const context: AgentRunContext = {
      productId,
      companyName,
      agentInstance,
      goldenLessons,
      constitution,
      runDate,
      agentConfig,
      integrationEvents,
      unreadMessages,
      scratchpadContext: scratchpadContext || undefined,
    };

    // 12. Call analyzeAndAct — catch errors, mark session failed if throws
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

    // Write key finding to scratchpad for other agents (fire-and-forget)
    if (result.briefingContribution) {
      import('../coordination/scratchpad.js').then(({ writeAgentFinding }) => {
        writeAgentFinding(productId, agentName, {
          position: result.briefingContribution,
          confidence: result.domainHealthScore !== undefined ? result.domainHealthScore / 100 : 0.5,
        }).catch((err) => { logger.error(`writeAgentFinding failed for ${agentName}/${productId}: ${err}`); });
      }).catch((err) => { logger.error(`import scratchpad.js failed: ${err}`); });
    }

    // 13. On success: update session row
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
        0, // cost_usd back-filled below
        sessionId,
      ]
    );

    // 14. Update agent_instances row
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

    // 15. Log cost — both to legacy agent_cost_log and new P&L cost_events (v2)
    // Fallback when an agent didn't compute its own cost: charge the combined
    // token count at the operational (Sonnet) output rate via computeCostCents.
    const costUsd = result.costUsd !== undefined
      ? result.costUsd
      : computeCostCents(MODELS.SONNET, 0, result.tokensUsed) / 100;
    if (costUsd > 0 || result.tokensUsed > 0) {
      await query(
        `UPDATE agent_sessions SET cost_usd=? WHERE id=?`,
        [costUsd, sessionId]
      );
      await query(
        `INSERT INTO agent_cost_log (id, product_id, agent_name, session_id, tokens_output, cost_usd, action_type, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [nanoid(), productId, agentName, sessionId, result.tokensUsed, costUsd, 'agent_session']
      );
      // Fire-and-forget: also log to AI Company P&L cost_events
      import('../../financial/economics.js').then(({ logCost }) => {
        logCost({
          productId,
          agentName,
          costType: 'llm_tokens',
          amountUsd: costUsd,
          sessionId,
          details: { tokens: result.tokensUsed, session: sessionId },
        }).catch((err) => { logger.error(`logCost failed for ${agentName}/${productId}: ${err}`); });
      }).catch((err) => { logger.error(`import economics.js failed: ${err}`); });
    }

    // 16. Process v2/v3 signal fields (all fire-and-forget, non-fatal)

    // Customer signals → customer_intelligence
    if (result.customerSignals && result.customerSignals.length > 0) {
      const signals = result.customerSignals;
      import('../../customer/intelligence.js').then(({ upsertCustomer, addAgentNote, updateHealthScore }) => {
        for (const sig of signals) {
          const { note, external_id, name, email, mrr_cents, plan,
                  health_login_score, health_feature_score,
                  health_sentiment_score, health_billing_score, stage } = sig;
          upsertCustomer(productId, {
            external_customer_id: external_id,
            account_name: name,
            email,
            plan,
            mrr_cents,
          }).then(async (customer) => {
            // Update health sub-scores if provided
            if (health_login_score !== undefined || health_feature_score !== undefined ||
                health_sentiment_score !== undefined || health_billing_score !== undefined) {
              await updateHealthScore(customer.id, {
                login_frequency_score: health_login_score,
                feature_depth_score: health_feature_score,
                support_sentiment_score: health_sentiment_score,
                billing_health_score: health_billing_score,
              }).catch((err) => { logger.error(`updateHealthScore failed for customer ${customer.id}: ${err}`); });
            }
            if (note) {
              await addAgentNote(customer.id, agentName, note).catch((err) => { logger.error(`addAgentNote failed for customer ${customer.id}: ${err}`); });
            }
          }).catch((err) => { logger.error(`upsertCustomer failed for ${agentName}/${productId}: ${err}`); });
        }
      }).catch((err) => { logger.error(`import customer/intelligence.js failed: ${err}`); });
    }

    // Agent messages → agent_messages bus
    if (result.agentMessages && result.agentMessages.length > 0) {
      const messages = result.agentMessages;
      // Map 'update' type (not in enum) → 'report'
      const validTypes = new Set(['insight', 'request', 'alert', 'handoff', 'question', 'report']);
      import('../messages.js').then(({ sendMessage }) => {
        for (const msg of messages) {
          const msgType = validTypes.has(msg.message_type) ? msg.message_type : 'report';
          sendMessage({
            productId,
            fromAgent: agentName,
            toAgent: msg.to_agent,
            type: msgType as 'insight' | 'request' | 'alert' | 'handoff' | 'question' | 'report',
            priority: msg.priority as 'low' | 'medium' | 'high' | 'critical',
            subject: msg.subject,
            body: msg.body,
            context: { sessionId },
          }).catch((err) => { logger.error(`sendMessage failed from ${agentName} to ${msg.to_agent}: ${err}`); });
        }
      }).catch((err) => { logger.error(`import messages.js failed: ${err}`); });
    }

    // Outbound actions → outbound_actions queue
    if (result.outboundActions && result.outboundActions.length > 0) {
      const actions = result.outboundActions;
      import('../../outbound/executor.js').then(({ proposeAction }) => {
        for (const action of actions) {
          proposeAction({
            productId,
            agentName,
            integrationName: agentName, // agent as the integration source
            actionType: action.action_type,
            authorityLevel: action.authority_level,
            parameters: action.parameters,
            rationale: action.description,
            previewText: action.description.slice(0, 200),
            confidence: 0.8,
          }).catch((err) => { logger.error(`proposeAction failed for ${agentName}/${productId}: ${err}`); });
        }
      }).catch((err) => { logger.error(`import outbound/executor.js failed: ${err}`); });
    }

    // Hypotheses → experiments engine
    if (result.hypotheses && result.hypotheses.length > 0) {
      const hypotheses = result.hypotheses;
      import('../experiments.js').then(({ proposeHypothesis }) => {
        for (const hyp of hypotheses) {
          // Build the statement from title + hypothesis
          const statement = `[${hyp.title}] ${hyp.hypothesis} — Success metric: ${hyp.success_metric} (target: ${(hyp.success_threshold * 100).toFixed(0)}% improvement)`;
          proposeHypothesis(productId, {
            proposedBy: agentName,
            statement,
            predictedEffectSize: hyp.success_threshold,
            estimatedDurationDays: hyp.test_duration_days,
            riskAssessment: `Proposed by ${agentName} — requires human validation before running.`,
          }).catch((err) => { logger.error(`proposeHypothesis failed for ${agentName}/${productId}: ${err}`); });
        }
      }).catch((err) => { logger.error(`import experiments.js failed: ${err}`); });
    }

    // Mark integration events as processed
    if (integrationEvents && integrationEvents.length > 0) {
      this._markEventsProcessed(productId, agentName).catch((err) => { logger.error(`_markEventsProcessed failed for ${agentName}/${productId}: ${err}`); });
    }

    // Auto-extract predictions from agent output (v4 accuracy tracking)
    import('../accuracy/calibrator.js').then(({ extractPredictionsFromAnalysis }) => {
      extractPredictionsFromAnalysis(productId, agentName, sessionId, {
        customerSignals: result.customerSignals,
        outboundActions: result.outboundActions,
        hypotheses: result.hypotheses,
      }).catch((err) => { logger.error(`extractPredictionsFromAnalysis failed for ${agentName}/${productId}: ${err}`); });
    }).catch((err) => { logger.error(`import accuracy/calibrator.js failed: ${err}`); });

    // 17. Trigger evolution check if there are candidates (fire-and-forget)
    if (result.evolutionCandidates.length > 0) {
      import('../evolution.js').then(({ checkEvolutionCandidates }) => {
        checkEvolutionCandidates(productId, agentName, sessionId, result.evolutionCandidates).catch((err) => {
          logger.error(`checkEvolutionCandidates failed for ${agentName}/${productId}: ${err}`);
        });
      }).catch((err) => { logger.error(`import evolution.js failed: ${err}`); });
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
        agentName.charAt(0).toUpperCase() + agentName.slice(1),
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

    // Inject typed config sections (v2) — persona and domain_knowledge enrich the prompt
    if (context.agentConfig) {
      const { persona, domain_knowledge, task_patterns } = context.agentConfig;
      if (persona && !domainSystemPrompt.includes(persona.slice(0, 50))) {
        parts.push(`AGENT PERSONA:\n${persona}`);
      }
      if (domain_knowledge) {
        parts.push(`DOMAIN EXPERTISE:\n${domain_knowledge}`);
      }
      if (task_patterns) {
        parts.push(`TASK PATTERNS:\n${task_patterns}`);
      }
    }

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

    // Inject integration events (v2) — sanitize summaries (user-controlled data)
    if (context.integrationEvents && context.integrationEvents.length > 0) {
      const eventLines = context.integrationEvents.slice(0, 15).map(e =>
        `[${sanitizeForPrompt(e.source)}/${sanitizeForPrompt(e.event_type)}] ${sanitizeForPrompt(e.summary)}`
      ).join('\n');
      parts.push(`INTEGRATION SIGNALS (${context.integrationEvents.length} since last run):\n${eventLines}`);
    }

    // Inject unread agent messages (v2) — sanitize subject/body (may contain external data)
    if (context.unreadMessages && context.unreadMessages.length > 0) {
      const msgLines = context.unreadMessages.map(m =>
        `[${sanitizeForPrompt(m.from_agent)} · ${m.priority}] ${sanitizeForPrompt(m.subject)}: ${sanitizeForPrompt(m.body.slice(0, 300))}`
      ).join('\n');
      parts.push(`MESSAGES FROM AGENT NETWORK:\n${msgLines}`);
    }

    // Inject scratchpad context — what other agents found today
    if (context.scratchpadContext) {
      parts.push(context.scratchpadContext);
    }

    parts.push(`Today's date: ${context.runDate}`);

    // ── C-Suite Output Standard (injected into every agent) ───────────────────
    parts.push(`
REQUIRED OUTPUT FORMAT — C-SUITE STANDARD:
You are advising the CEO. Every significant finding MUST be structured as follows:

POSITION: A declarative statement of what is true. Own it. No hedging.
CONFIDENCE: [X%] — one sentence explaining why you are or aren't confident.
STAKES: What is concretely at risk (dollars, customers, runway, strategic position) if this is ignored for 30 days.
ACTION: One specific action. One owner (founder / cs / sales / engineering / product). One deadline.
SIGNAL: The single metric or event you will monitor to confirm the action worked within 14 days.

Rules:
- Do NOT present observations as analysis. "Churn is 4%" is an observation. "You will miss Q2 ARR by $18K unless you retain Accounts X and Y in the next 21 days" is analysis.
- Do NOT hedge without quantifying uncertainty. Say "Confidence: 35% — only 2 data points" rather than "this may suggest."
- If you disagree with the founder's recent decisions, say so explicitly with evidence.
- Surface what the founder does NOT know, not what they already see in their dashboard.
- Maximum 3 significant findings per run. Quality over volume.
- If you have insufficient data to form a confident view, say exactly that and describe what data would change your analysis.`);

    return parts.join('\n\n');
  }

  protected formatGoldenLessons(lessons: GoldenSuiteEntry[]): string {
    if (!lessons || lessons.length === 0) return '';
    const lines = lessons.map((l, i) => `${i + 1}. ${l.lesson}`);
    return 'GOLDEN LESSONS (learned behaviors for this company):\n' + lines.join('\n');
  }

  // ─── v2 Context loaders ───────────────────────────────────────────────────

  private async _loadAgentConfig(productId: string, agentName: string): Promise<Record<string, string>> {
    try {
      const { getAgentConfig } = await import('../agent-config.js');
      return await getAgentConfig(productId, agentName);
    } catch {
      return {};
    }
  }

  private async _loadIntegrationEvents(
    productId: string,
    agentName: string,
    _lastRunAt: string | null
  ): Promise<IntegrationEventSummary[]> {
    try {
      const { getUnprocessedEvents } = await import('../../integration/fabric.js');
      const events = await getUnprocessedEvents(productId, agentName, 20);
      return events.slice(0, 20).map(e => ({
        source: e.integration_name,
        event_type: e.event_type,
        summary: this._summariseEvent(e.event_type, e.data),
        created_at: e.created_at,
      }));
    } catch {
      return [];
    }
  }

  private _summariseEvent(eventType: string, data: Record<string, unknown>): string {
    // Produce a compact ≤200-char summary for the agent prompt
    // Sanitize values — data originates from external integrations (GitHub commits, tickets, etc.)
    const parts: string[] = [sanitizeForPrompt(eventType)];
    for (const key of ['customer_id', 'customer_email', 'amount', 'plan', 'event', 'actor']) {
      if (data[key] !== undefined) parts.push(`${key}=${sanitizeForPrompt(String(data[key]).slice(0, 40))}`);
    }
    return parts.join(' | ').slice(0, 200);
  }

  private async _loadUnreadMessages(productId: string, agentName: string): Promise<IncomingAgentMessage[]> {
    try {
      const { getUnreadMessages } = await import('../messages.js');
      const messages = await getUnreadMessages(productId, agentName);
      return messages.slice(0, 10).map(m => ({
        from_agent: m.from_agent,
        priority: m.priority,
        subject: m.subject,
        body: m.body,
        sent_at: m.created_at,
      }));
    } catch {
      return [];
    }
  }

  private async _markEventsProcessed(productId: string, agentName: string): Promise<void> {
    try {
      const { markEventsProcessed } = await import('../../integration/fabric.js');
      // Fetch the IDs that were just loaded and mark them
      const { getUnprocessedEvents } = await import('../../integration/fabric.js');
      const events = await getUnprocessedEvents(productId, agentName);
      if (events.length > 0) {
        await markEventsProcessed(events.map(e => e.id), agentName);
      }
    } catch {
      // Non-fatal
    }
  }

  private async _processInitiatives(productId: string, agentName: string, sessionId: string): Promise<void> {
    // Check for pending self-initiated actions from the initiative queue
    try {
      const result = await query(
        `SELECT id, action_type, action_description, parameters_json
         FROM agent_initiative_queue
         WHERE product_id=? AND agent_name=? AND status='pending'
         ORDER BY priority DESC, created_at ASC
         LIMIT 3`,
        [productId, agentName]
      );
      if (result.rows.length === 0) return;

      for (const row of result.rows as Record<string, unknown>[]) {
        // Mark as in_progress
        await query(
          `UPDATE agent_initiative_queue SET status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [row.id as string]
        );
        // Route into outbound executor for human approval
        const { proposeAction } = await import('../../outbound/executor.js');
        const actionDesc = row.action_description as string;
        await proposeAction({
          productId,
          agentName,
          integrationName: agentName,
          actionType: row.action_type as string,
          rationale: actionDesc,
          previewText: actionDesc.slice(0, 200),
          parameters: this._parseJSON<Record<string, unknown>>(row.parameters_json as string | null, {}),
          authorityLevel: 2, // All initiative queue items require approval
        }).catch(() => {});
        // Mark as proposed
        await query(
          `UPDATE agent_initiative_queue SET status='proposed', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [row.id as string]
        );
      }
    } catch {
      // Non-fatal
    }
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
    const levels: Record<string, number> = {
      atlas: 2, compass: 2, prism: 2, beacon: 2, scribe: 1,
      forge: 2, harbor: 1, sentinel: 1, ledger: 1, shield: 2,
      oracle: 0, crucible: 1,
    };
    return levels[this.getName()] ?? 2;
  }
}
