// =============================================================================
// FOUNDRY — SCPInstance
// Manages all 12 agents for one company. Orchestrates runs, briefings,
// lifecycle state transitions, and health scoring.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet } from '../ai/client.js';
import { generateDailyBriefing, getLatestBriefing as getBriefingFromStore } from './briefing.js';
import type {
  AgentName,
  AgentSessionOutput,
  AgentBriefingContribution,
  AgentDecision,
  AgentAction,
  SCPBriefing,
  SCPInstanceStatus,
  CompanyLifecycleState,
  SCPStatus,
  FinancialSummary,
  AGENT_HEALTH_WEIGHTS,
  ALL_AGENTS,
} from './types.js';
import {
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  AGENT_HEALTH_WEIGHTS as WEIGHTS,
  ALL_AGENTS as AGENTS,
} from './types.js';

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class SCPInstance {
  constructor(private readonly productId: string) {}

  // ─── Status ───────────────────────────────────────────────────────────────

  async getStatus(): Promise<SCPInstanceStatus> {
    const productResult = await query(
      `SELECT name, company_lifecycle_state, scp_status, health_score,
              total_evolution_cycles, golden_suite_size,
              ai_cost_trailing_30d_usd, attributed_revenue_trailing_30d_usd
       FROM products WHERE id=?`,
      [this.productId]
    );

    if (productResult.rows.length === 0) {
      throw new Error(`Product ${this.productId} not found`);
    }

    const prod = productResult.rows[0] as Record<string, unknown>;

    const instancesResult = await query(
      'SELECT * FROM agent_instances WHERE product_id=?',
      [this.productId]
    );

    const briefingResult = await query(
      'SELECT briefing_date FROM scp_briefings WHERE product_id=? ORDER BY briefing_date DESC LIMIT 1',
      [this.productId]
    );

    const agents = AGENTS.map((name) => {
      const row = instancesResult.rows.find(
        (r) => (r as Record<string, unknown>).agent_name === name
      ) as Record<string, unknown> | undefined;

      if (!row) {
        return {
          name,
          displayName: AGENT_DISPLAY_NAMES[name],
          version: 1,
          authorityLevel: 2 as 0 | 1 | 2,
          status: 'active' as const,
          totalSessions: 0,
          successRate: 0,
          domainHealthScore: 50,
          lastRunAt: null,
          nextRunAt: null,
        };
      }

      const total = (row.total_sessions as number) ?? 0;
      const successful = (row.successful_sessions as number) ?? 0;
      const successRate = total > 0 ? successful / total : 0;

      return {
        name,
        displayName: AGENT_DISPLAY_NAMES[name],
        version: (row.version as number) ?? 1,
        authorityLevel: (row.authority_level as 0 | 1 | 2) ?? 2,
        status: (row.status as 'active' | 'paused' | 'error') ?? 'active',
        totalSessions: total,
        successRate,
        domainHealthScore: (row.domain_health_score as number) ?? 50,
        lastRunAt: (row.last_run_at as string) ?? null,
        nextRunAt: (row.next_run_at as string) ?? null,
      };
    });

    const totalEvoCycles = instancesResult.rows.reduce(
      (acc, r) => acc + ((r as Record<string, unknown>).total_evolution_cycles as number ?? 0),
      0
    );

    return {
      productId: this.productId,
      companyName: (prod.name as string) ?? 'Unknown',
      lifecycleState: (prod.company_lifecycle_state as CompanyLifecycleState) ?? 'setup',
      scpStatus: (prod.scp_status as SCPStatus) ?? 'provisioning',
      healthScore: (prod.health_score as number) ?? 0,
      agents,
      totalEvolutionCycles: totalEvoCycles,
      goldenSuiteSize: (prod.golden_suite_size as number) ?? 0,
      latestBriefingDate: briefingResult.rows.length > 0
        ? ((briefingResult.rows[0] as Record<string, unknown>).briefing_date as string)
        : null,
      aiCost30d: (prod.ai_cost_trailing_30d_usd as number) ?? 0,
      attributedRevenue30d: (prod.attributed_revenue_trailing_30d_usd as number) ?? 0,
    };
  }

  // ─── Run single agent ─────────────────────────────────────────────────────

  async runAgent(agentName: AgentName): Promise<AgentSessionOutput> {
    const module = await import(`./agents/${agentName}.js`);
    // Agent modules export a default class
    const AgentClass = module.default ?? module[Object.keys(module)[0]];
    const agent = new AgentClass();
    return agent.run(this.productId);
  }

  // ─── Run all due agents ───────────────────────────────────────────────────

  async runAllDueAgents(): Promise<AgentSessionOutput[]> {
    const dueResult = await query(
      `SELECT agent_name FROM agent_instances
       WHERE product_id=? AND status='active' AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)`,
      [this.productId]
    );

    const outputs: AgentSessionOutput[] = [];

    for (const row of dueResult.rows) {
      const agentName = (row as Record<string, unknown>).agent_name as AgentName;
      try {
        const output = await this.runAgent(agentName);
        outputs.push(output);
      } catch (err) {
        // One agent failing should not stop others
        const errorMsg = err instanceof Error ? err.message : String(err);
        outputs.push({
          sessionId: nanoid(),
          agentName,
          productId: this.productId,
          success: false,
          durationMs: 0,
          observations: [],
          actionsTaken: [],
          pendingDecisions: [],
          briefingContribution: `${agentName} failed to run: ${errorMsg}`,
          briefingPriority: 'low',
          evolutionCandidates: [],
          tokensUsed: 0,
          costUsd: 0,
        });
      }
    }

    return outputs;
  }

  // ─── Generate briefing ────────────────────────────────────────────────────

  async generateBriefing(forDate?: string): Promise<SCPBriefing> {
    return generateDailyBriefing(this.productId, forDate);
  }

  // ─── Get latest briefing ──────────────────────────────────────────────────

  async getLatestBriefing(): Promise<SCPBriefing | null> {
    return getBriefingFromStore(this.productId);
  }

  // ─── Decision management ──────────────────────────────────────────────────

  async approveDecision(decisionId: string): Promise<void> {
    // Mark decision as approved in agent_sessions pending_decisions
    // We update the pending_decisions JSON in the session that contains this decision
    const sessionsResult = await query(
      `SELECT id, pending_decisions FROM agent_sessions
       WHERE product_id=? AND pending_decisions IS NOT NULL
       ORDER BY started_at DESC LIMIT 50`,
      [this.productId]
    );

    for (const row of sessionsResult.rows) {
      const r = row as Record<string, unknown>;
      const decisions = parseJSON<AgentDecision[]>(r.pending_decisions as string | null, []);
      const idx = decisions.findIndex((d) => d.id === decisionId);
      if (idx === -1) continue;

      decisions[idx] = { ...decisions[idx], action_data: { ...decisions[idx].action_data, approved: true, approved_at: new Date().toISOString() } };
      await query(
        `UPDATE agent_sessions SET pending_decisions=? WHERE id=?`,
        [JSON.stringify(decisions), r.id as string]
      );

      // Track approved decision count on agent instance
      await query(
        `UPDATE agent_instances SET total_decisions_approved=total_decisions_approved+1, updated_at=CURRENT_TIMESTAMP
         WHERE product_id=? AND agent_name=?`,
        [this.productId, decisions[idx].agent_name]
      );
      return;
    }

    throw new Error(`Decision ${decisionId} not found for product ${this.productId}`);
  }

  async denyDecision(decisionId: string, reason: string): Promise<void> {
    const sessionsResult = await query(
      `SELECT id, pending_decisions FROM agent_sessions
       WHERE product_id=? AND pending_decisions IS NOT NULL
       ORDER BY started_at DESC LIMIT 50`,
      [this.productId]
    );

    for (const row of sessionsResult.rows) {
      const r = row as Record<string, unknown>;
      const decisions = parseJSON<AgentDecision[]>(r.pending_decisions as string | null, []);
      const idx = decisions.findIndex((d) => d.id === decisionId);
      if (idx === -1) continue;

      decisions[idx] = { ...decisions[idx], action_data: { ...decisions[idx].action_data, denied: true, deny_reason: reason, denied_at: new Date().toISOString() } };
      await query(
        `UPDATE agent_sessions SET pending_decisions=? WHERE id=?`,
        [JSON.stringify(decisions), r.id as string]
      );
      return;
    }

    throw new Error(`Decision ${decisionId} not found for product ${this.productId}`);
  }

  // ─── Pause / Resume ───────────────────────────────────────────────────────

  async pauseAgent(agentName: AgentName): Promise<void> {
    await query(
      `UPDATE agent_instances SET status='paused', updated_at=CURRENT_TIMESTAMP
       WHERE product_id=? AND agent_name=?`,
      [this.productId, agentName]
    );
  }

  async resumeAgent(agentName: AgentName): Promise<void> {
    await query(
      `UPDATE agent_instances SET status='active', updated_at=CURRENT_TIMESTAMP
       WHERE product_id=? AND agent_name=?`,
      [this.productId, agentName]
    );
  }

  // ─── Health score ─────────────────────────────────────────────────────────

  async computeHealthScore(): Promise<number> {
    const result = await query(
      'SELECT agent_name, domain_health_score FROM agent_instances WHERE product_id=?',
      [this.productId]
    );

    let weightedSum = 0;
    let weightUsed = 0;

    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const name = r.agent_name as AgentName;
      const score = (r.domain_health_score as number) ?? 50;
      const weight = WEIGHTS[name] ?? 0;
      weightedSum += score * weight;
      weightUsed += weight;
    }

    // If no weighted agents have run yet, return 50 as neutral
    const healthScore = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : 50;

    // Update products.health_score
    await query(
      `UPDATE products SET health_score=? WHERE id=?`,
      [healthScore, this.productId]
    );

    return healthScore;
  }

  // ─── Lifecycle state ──────────────────────────────────────────────────────

  async updateLifecycleState(): Promise<CompanyLifecycleState> {
    const productResult = await query(
      `SELECT company_lifecycle_state, health_score FROM products WHERE id=?`,
      [this.productId]
    );

    if (productResult.rows.length === 0) throw new Error(`Product ${this.productId} not found`);

    const prod = productResult.rows[0] as Record<string, unknown>;
    const current = (prod.company_lifecycle_state as CompanyLifecycleState) ?? 'setup';

    const instancesResult = await query(
      `SELECT total_sessions, successful_sessions, total_evolution_cycles FROM agent_instances WHERE product_id=?`,
      [this.productId]
    );

    const totalSessions = instancesResult.rows.reduce(
      (acc, r) => acc + ((r as Record<string, unknown>).total_sessions as number ?? 0),
      0
    );
    const totalSuccessful = instancesResult.rows.reduce(
      (acc, r) => acc + ((r as Record<string, unknown>).successful_sessions as number ?? 0),
      0
    );
    const totalEvoCycles = instancesResult.rows.reduce(
      (acc, r) => acc + ((r as Record<string, unknown>).total_evolution_cycles as number ?? 0),
      0
    );

    const avgSuccessRate = totalSessions > 0 ? totalSuccessful / totalSessions : 0;
    const healthScore = (prod.health_score as number) ?? 0;

    let newState: CompanyLifecycleState = current;

    if (current === 'setup' && totalSessions > 0) {
      newState = 'learning';
    } else if (current === 'learning' && totalSessions >= 50 && avgSuccessRate >= 0.85) {
      newState = 'operating';
    } else if (current === 'operating' && totalEvoCycles >= 20 && healthScore >= 75) {
      newState = 'optimizing';
    }

    if (newState !== current) {
      await query(
        `UPDATE products SET company_lifecycle_state=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [newState, this.productId]
      );
    }

    return newState;
  }
}
