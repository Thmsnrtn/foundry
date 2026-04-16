// =============================================================================
// FOUNDRY — Agent Run Recorder
// Records full transparency details for each agent run.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

export interface RunRecord {
  productId: string;
  agentName: string;
  sessionId: string;
  contextSummary: {
    metrics_snapshot_date?: string;
    integration_events_count: number;
    unread_messages_count: number;
    config_keys_count: number;
    stressors_active?: number;
    customer_count?: number;
  };
  systemPromptPreview?: string;
  userPromptPreview?: string;
}

/**
 * Insert a new agent_run_details row with status='running'. Returns the run record id.
 */
export async function startRunRecord(record: RunRecord): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();

  await query(
    `INSERT INTO agent_run_details
       (id, product_id, agent_name, session_id, run_started_at, status,
        context_summary_json, system_prompt_preview, user_prompt_preview)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      id,
      record.productId,
      record.agentName,
      record.sessionId,
      now,
      JSON.stringify(record.contextSummary),
      record.systemPromptPreview?.slice(0, 500) ?? null,
      record.userPromptPreview?.slice(0, 500) ?? null,
    ]
  );

  return id;
}

/**
 * Mark a run record as completed and fill in all result fields.
 */
export async function completeRunRecord(
  runRecordId: string,
  result: {
    decisions_count: number;
    actions_count: number;
    hypotheses_count: number;
    messages_sent_count: number;
    customer_signals_count: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    domain_health_score?: number;
    headline?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  await query(
    `UPDATE agent_run_details SET
       status = 'completed',
       run_completed_at = ?,
       decisions_count = ?,
       actions_count = ?,
       hypotheses_count = ?,
       messages_sent_count = ?,
       customer_signals_count = ?,
       input_tokens = ?,
       output_tokens = ?,
       cost_usd = ?,
       latency_ms = ?,
       domain_health_score = ?,
       headline = ?
     WHERE id = ?`,
    [
      now,
      result.decisions_count,
      result.actions_count,
      result.hypotheses_count,
      result.messages_sent_count,
      result.customer_signals_count,
      result.input_tokens,
      result.output_tokens,
      result.cost_usd,
      result.latency_ms,
      result.domain_health_score ?? null,
      result.headline ?? null,
      runRecordId,
    ]
  );
}

/**
 * Mark a run record as failed with an error message.
 */
export async function failRunRecord(runRecordId: string, errorMessage: string): Promise<void> {
  const now = new Date().toISOString();

  await query(
    `UPDATE agent_run_details SET
       status = 'failed',
       run_completed_at = ?,
       error_message = ?
     WHERE id = ?`,
    [now, errorMessage, runRecordId]
  );
}

/**
 * Get full details for a single run record.
 */
export async function getRunDetails(runRecordId: string): Promise<{
  id: string;
  agent_name: string;
  status: string;
  context_summary: Record<string, unknown>;
  system_prompt_preview: string | null;
  user_prompt_preview: string | null;
  decisions_count: number;
  actions_count: number;
  hypotheses_count: number;
  messages_sent_count: number;
  customer_signals_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  domain_health_score: number | null;
  headline: string | null;
  error_message: string | null;
  run_started_at: string;
  run_completed_at: string | null;
} | null> {
  const result = await query(
    'SELECT * FROM agent_run_details WHERE id = ?',
    [runRecordId]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0] as Record<string, unknown>;

  let contextSummary: Record<string, unknown> = {};
  try {
    contextSummary = JSON.parse(r.context_summary_json as string) as Record<string, unknown>;
  } catch {
    // keep empty object
  }

  return {
    id: r.id as string,
    agent_name: r.agent_name as string,
    status: r.status as string,
    context_summary: contextSummary,
    system_prompt_preview: r.system_prompt_preview as string | null,
    user_prompt_preview: r.user_prompt_preview as string | null,
    decisions_count: (r.decisions_count as number) ?? 0,
    actions_count: (r.actions_count as number) ?? 0,
    hypotheses_count: (r.hypotheses_count as number) ?? 0,
    messages_sent_count: (r.messages_sent_count as number) ?? 0,
    customer_signals_count: (r.customer_signals_count as number) ?? 0,
    input_tokens: (r.input_tokens as number) ?? 0,
    output_tokens: (r.output_tokens as number) ?? 0,
    cost_usd: (r.cost_usd as number) ?? 0,
    latency_ms: r.latency_ms as number | null,
    domain_health_score: r.domain_health_score as number | null,
    headline: r.headline as string | null,
    error_message: (r.error_message as string) ?? null,
    run_started_at: r.run_started_at as string,
    run_completed_at: r.run_completed_at as string | null,
  };
}

/**
 * Get the run history for a specific agent (most recent first).
 */
export async function getAgentRunHistory(
  productId: string,
  agentName: string,
  limit = 20
): Promise<Array<{
  id: string;
  status: string;
  cost_usd: number;
  latency_ms: number | null;
  domain_health_score: number | null;
  headline: string | null;
  decisions_count: number;
  actions_count: number;
  run_started_at: string;
}>> {
  const result = await query(
    `SELECT id, status, cost_usd, latency_ms, domain_health_score, headline,
            decisions_count, actions_count, run_started_at
     FROM agent_run_details
     WHERE product_id = ? AND agent_name = ?
     ORDER BY run_started_at DESC
     LIMIT ?`,
    [productId, agentName, limit]
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      status: r.status as string,
      cost_usd: (r.cost_usd as number) ?? 0,
      latency_ms: r.latency_ms as number | null,
      domain_health_score: r.domain_health_score as number | null,
      headline: r.headline as string | null,
      decisions_count: (r.decisions_count as number) ?? 0,
      actions_count: (r.actions_count as number) ?? 0,
      run_started_at: r.run_started_at as string,
    };
  });
}

/**
 * Get cost summary grouped by agent for the last N days.
 */
export async function getAgentCostSummary(
  productId: string,
  days = 30
): Promise<Array<{
  agent_name: string;
  total_runs: number;
  total_cost_usd: number;
  avg_cost_per_run: number;
  avg_latency_ms: number | null;
  total_tokens: number;
}>> {
  const result = await query(
    `SELECT
       agent_name,
       COUNT(*) as total_runs,
       SUM(cost_usd) as total_cost_usd,
       AVG(cost_usd) as avg_cost_per_run,
       AVG(latency_ms) as avg_latency_ms,
       SUM(input_tokens + output_tokens) as total_tokens
     FROM agent_run_details
     WHERE product_id = ?
       AND run_started_at >= datetime('now', ? || ' days')
     GROUP BY agent_name
     ORDER BY total_cost_usd DESC`,
    [productId, `-${days}`]
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      agent_name: r.agent_name as string,
      total_runs: (r.total_runs as number) ?? 0,
      total_cost_usd: (r.total_cost_usd as number) ?? 0,
      avg_cost_per_run: (r.avg_cost_per_run as number) ?? 0,
      avg_latency_ms: r.avg_latency_ms as number | null,
      total_tokens: (r.total_tokens as number) ?? 0,
    };
  });
}

/**
 * Get the most recent runs across all agents for a product.
 */
export async function getRecentRuns(
  productId: string,
  limit = 20
): Promise<Array<{
  id: string;
  agent_name: string;
  status: string;
  cost_usd: number;
  latency_ms: number | null;
  domain_health_score: number | null;
  headline: string | null;
  decisions_count: number;
  actions_count: number;
  run_started_at: string;
}>> {
  const result = await query(
    `SELECT id, agent_name, status, cost_usd, latency_ms, domain_health_score, headline,
            decisions_count, actions_count, run_started_at
     FROM agent_run_details
     WHERE product_id = ?
     ORDER BY run_started_at DESC
     LIMIT ?`,
    [productId, limit]
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      agent_name: r.agent_name as string,
      status: r.status as string,
      cost_usd: (r.cost_usd as number) ?? 0,
      latency_ms: r.latency_ms as number | null,
      domain_health_score: r.domain_health_score as number | null,
      headline: r.headline as string | null,
      decisions_count: (r.decisions_count as number) ?? 0,
      actions_count: (r.actions_count as number) ?? 0,
      run_started_at: r.run_started_at as string,
    };
  });
}
