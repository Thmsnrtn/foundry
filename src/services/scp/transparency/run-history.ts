// =============================================================================
// FOUNDRY — Agent run history, read from the table that agents actually write
//
// THE TRANSPARENCY PAGE READ A TABLE NOTHING HAS EVER WRITTEN.
//
// This module was `run-recorder.ts`. It exported `startRunRecord`,
// `completeRunRecord` and `failRunRecord` against `agent_run_details`, and
// nothing in the codebase called any of them — not the agents, not the
// orchestrator, not a job, not a test. Every read below it therefore returned
// an empty set for every company, for every window, forever, under a page
// headed "Agent Transparency" whose file comment said it "shows exactly what
// each agent sees, thinks, and costs per run". The page rendered its empty
// states — "No run data yet. Agents will appear here once they complete their
// first run" — which reads as "no runs happened". Agents run daily.
//
// The runs ARE recorded. `agents/base.ts` inserts an `agent_sessions` row when
// a run starts and updates it on completion or failure, with tokens, cost,
// status, error and the briefing contribution. One concept, two tables, and
// the surface was pointed at the one with no writer.
//
// WHAT MOVED AND WHAT COULD NOT. `agent_sessions` holds the run, its status,
// its cost, its total tokens, its start and end, its error, its observations,
// its actions and its pending decisions. It does not hold prompt previews, a
// context summary, an input/output token split, or a per-run domain health
// score — so those sections are gone from the page rather than reimplemented
// from a store that does not have them. Domain health is kept per AGENT in
// `agent_instances.domain_health_score`, which is the agent's current score
// and not the score of any particular run; the page no longer draws it in a
// per-run column.
//
// THE READ IS SCOPED. `getRunDetails` took a run id alone and selected on it —
// one founder could read another company's run detail, prompt previews and
// all, by knowing an id. Unexploitable only because the table was empty. Every
// function here takes the company and every query filters on it.
// =============================================================================

import { query } from '../../../db/client.js';

/** Milliseconds between two SQLite datetimes, as SQL. NULL while running. */
const LATENCY_MS = `CAST((julianday(completed_at) - julianday(started_at)) * 86400000 AS INTEGER)`;

function countJSON(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function parseArray(value: unknown): unknown[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface AgentCostRow {
  agent_name: string;
  total_runs: number;
  /** Runs that reached 'completed'. The cost average is over these. */
  completed_runs: number;
  total_cost_usd: number;
  /** NULL when no run completed: an average over nothing is not zero. */
  avg_cost_per_completed_run: number | null;
  avg_latency_ms: number | null;
  total_tokens: number;
}

/**
 * Cost and latency per agent over a window.
 *
 * The average is per COMPLETED run, and the completed count is returned beside
 * it. A failed run's `cost_usd` stays at its 0 default — `base.ts` records the
 * failure without a cost — so dividing total cost by total runs mixed a real
 * numerator with a denominator that includes runs which recorded nothing.
 */
export async function getAgentCostSummary(
  productId: string,
  days = 30,
): Promise<AgentCostRow[]> {
  const result = await query(
    `SELECT
       agent_name,
       COUNT(*) as total_runs,
       SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_runs,
       SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
       AVG(CASE WHEN status='completed' THEN COALESCE(cost_usd, 0) END) as avg_cost_per_completed_run,
       AVG(${LATENCY_MS}) as avg_latency_ms,
       SUM(COALESCE(tokens_used, 0)) as total_tokens
     FROM agent_sessions
     WHERE product_id = ?
       AND started_at >= datetime('now', ? || ' days')
     GROUP BY agent_name
     ORDER BY total_cost_usd DESC, agent_name ASC`,
    [productId, `-${days}`],
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      agent_name: r.agent_name as string,
      total_runs: Number(r.total_runs ?? 0),
      completed_runs: Number(r.completed_runs ?? 0),
      total_cost_usd: Number(r.total_cost_usd ?? 0),
      avg_cost_per_completed_run: r.avg_cost_per_completed_run == null
        ? null : Number(r.avg_cost_per_completed_run),
      avg_latency_ms: r.avg_latency_ms == null ? null : Math.round(Number(r.avg_latency_ms)),
      total_tokens: Number(r.total_tokens ?? 0),
    };
  });
}

export interface AgentRunRow {
  id: string;
  agent_name: string;
  status: string;
  cost_usd: number;
  tokens_used: number;
  latency_ms: number | null;
  headline: string | null;
  decisions_count: number;
  actions_count: number;
  run_started_at: string;
}

const RUN_COLUMNS = `id, agent_name, status, COALESCE(cost_usd, 0) as cost_usd,
       COALESCE(tokens_used, 0) as tokens_used, ${LATENCY_MS} as latency_ms,
       briefing_contribution, pending_decisions, actions_taken, started_at`;

function toRunRow(row: unknown): AgentRunRow {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    agent_name: r.agent_name as string,
    status: r.status as string,
    cost_usd: Number(r.cost_usd ?? 0),
    tokens_used: Number(r.tokens_used ?? 0),
    latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
    headline: (r.briefing_contribution as string) ?? null,
    decisions_count: countJSON(r.pending_decisions),
    actions_count: countJSON(r.actions_taken),
    run_started_at: r.started_at as string,
  };
}

/** The most recent runs across all of this company's agents. */
export async function getRecentRuns(productId: string, limit = 20): Promise<AgentRunRow[]> {
  const result = await query(
    `SELECT ${RUN_COLUMNS}
       FROM agent_sessions
      WHERE product_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?`,
    [productId, limit],
  );
  return result.rows.map(toRunRow);
}

/** One agent's run history for this company, most recent first. */
export async function getAgentRunHistory(
  productId: string,
  agentName: string,
  limit = 20,
): Promise<AgentRunRow[]> {
  const result = await query(
    `SELECT ${RUN_COLUMNS}
       FROM agent_sessions
      WHERE product_id = ? AND agent_name = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?`,
    [productId, agentName, limit],
  );
  return result.rows.map(toRunRow);
}

export interface AgentRunDetail extends AgentRunRow {
  observations: string[];
  actions: unknown[];
  error_message: string | null;
  run_completed_at: string | null;
}

/** One run, belonging to this company. */
export async function getRunDetails(
  productId: string,
  runId: string,
): Promise<AgentRunDetail | null> {
  const result = await query(
    `SELECT ${RUN_COLUMNS}, observations, error_message, completed_at
       FROM agent_sessions
      WHERE id = ? AND product_id = ?`,
    [runId, productId],
  );
  if (result.rows.length === 0) return null;

  const r = result.rows[0] as Record<string, unknown>;
  return {
    ...toRunRow(r),
    observations: parseArray(r.observations).map((o) => String(o)),
    actions: parseArray(r.actions_taken),
    error_message: (r.error_message as string) ?? null,
    run_completed_at: (r.completed_at as string) ?? null,
  };
}

/**
 * The agent's CURRENT domain health, which is not a property of any one run.
 * `agent_instances.domain_health_score` is overwritten each time the agent
 * scores its domain; the per-run column the transparency page used to draw
 * never existed anywhere that was written.
 */
export async function getAgentCurrentHealth(
  productId: string,
  agentName: string,
): Promise<number | null> {
  const result = await query(
    'SELECT domain_health_score FROM agent_instances WHERE product_id = ? AND agent_name = ?',
    [productId, agentName],
  );
  if (result.rows.length === 0) return null;
  const v = (result.rows[0] as Record<string, unknown>).domain_health_score;
  return v == null ? null : Number(v);
}
