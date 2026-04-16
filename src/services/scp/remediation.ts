// =============================================================================
// FOUNDRY — SCP Remediation Engine
// Converts agent findings into trackable remediation items.
// Atlas finds tech debt → creates remediations.
// Crucible finds quality failures → creates remediations.
// Sentinel finds infra issues → creates remediations.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import type { AgentName } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RemediationItem {
  id: string;
  product_id: string;
  agent_name: AgentName;
  session_id: string | null;
  remediation_type: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  estimated_effort: string | null;
  affected_area: string | null;
  suggested_fix: string | null;
  github_issue_url: string | null;
  resolved_at: string | null;
  dismissed_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Create Remediation ───────────────────────────────────────────────────────

/**
 * Create a new agent remediation item. Deduplicates by (product_id, agent_name, title, status='open').
 * Returns the id of the created or existing remediation.
 */
export async function createRemediation(params: {
  productId: string;
  agentName: AgentName;
  sessionId?: string;
  remediationType: string;
  title: string;
  description: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  estimatedEffort?: string;
  affectedArea?: string;
  suggestedFix?: string;
}): Promise<string> {
  const {
    productId,
    agentName,
    sessionId,
    remediationType,
    title,
    description,
    severity = 'medium',
    estimatedEffort,
    affectedArea,
    suggestedFix,
  } = params;

  // Dedup: if open remediation with same product+agent+title already exists, return existing id
  const existing = await query(
    `SELECT id FROM agent_remediations
     WHERE product_id = ? AND agent_name = ? AND title = ? AND status = 'open'
     LIMIT 1`,
    [productId, agentName, title],
  );

  if (existing.rows.length > 0) {
    return (existing.rows[0] as Record<string, string>).id;
  }

  const id = nanoid();
  await query(
    `INSERT INTO agent_remediations
       (id, product_id, agent_name, session_id, remediation_type, title, description,
        severity, status, estimated_effort, affected_area, suggested_fix,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      productId,
      agentName,
      sessionId ?? null,
      remediationType,
      title,
      description,
      severity,
      estimatedEffort ?? null,
      affectedArea ?? null,
      suggestedFix ?? null,
    ],
  );

  return id;
}

// ─── Query Remediations ───────────────────────────────────────────────────────

/**
 * Get all pending (open + in_progress) remediations for a product.
 * Optionally filter by agent and/or severity.
 */
export async function getPendingRemediations(
  productId: string,
  options?: { agentName?: AgentName; severity?: string; limit?: number },
): Promise<RemediationItem[]> {
  const limit = options?.limit ?? 100;
  const args: unknown[] = [productId];
  let sql = `SELECT * FROM agent_remediations
             WHERE product_id = ?
               AND status IN ('open', 'in_progress')`;

  if (options?.agentName) {
    sql += ` AND agent_name = ?`;
    args.push(options.agentName);
  }

  if (options?.severity) {
    sql += ` AND severity = ?`;
    args.push(options.severity);
  }

  sql += ` ORDER BY
    CASE severity
      WHEN 'critical' THEN 1
      WHEN 'high'     THEN 2
      WHEN 'medium'   THEN 3
      WHEN 'low'      THEN 4
    END,
    created_at DESC
  LIMIT ?`;
  args.push(limit);

  const result = await query(sql, args);
  return result.rows.map((r) => rowToItem(r as Record<string, unknown>));
}

// ─── Resolve / Dismiss ────────────────────────────────────────────────────────

export async function resolveRemediation(id: string, productId: string): Promise<void> {
  await query(
    `UPDATE agent_remediations
     SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND product_id = ?`,
    [id, productId],
  );
}

export async function dismissRemediation(id: string, productId: string, reason: string): Promise<void> {
  await query(
    `UPDATE agent_remediations
     SET status = 'dismissed', dismissed_reason = ?, updated_at = datetime('now')
     WHERE id = ? AND product_id = ?`,
    [reason, id, productId],
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export async function getRemediationSummary(productId: string): Promise<{
  open: number;
  critical: number;
  high: number;
  by_agent: Record<string, number>;
}> {
  const result = await query(
    `SELECT severity, agent_name, COUNT(*) as cnt
     FROM agent_remediations
     WHERE product_id = ? AND status IN ('open', 'in_progress')
     GROUP BY severity, agent_name`,
    [productId],
  );

  let open = 0;
  let critical = 0;
  let high = 0;
  const by_agent: Record<string, number> = {};

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const count = Number(r.cnt) || 0;
    const sev = r.severity as string;
    const agent = r.agent_name as string;

    open += count;
    if (sev === 'critical') critical += count;
    if (sev === 'high') high += count;
    by_agent[agent] = (by_agent[agent] ?? 0) + count;
  }

  return { open, critical, high, by_agent };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function rowToItem(r: Record<string, unknown>): RemediationItem {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    agent_name: r.agent_name as AgentName,
    session_id: r.session_id as string | null,
    remediation_type: r.remediation_type as string,
    title: r.title as string,
    description: r.description as string,
    severity: r.severity as RemediationItem['severity'],
    status: r.status as RemediationItem['status'],
    estimated_effort: r.estimated_effort as string | null,
    affected_area: r.affected_area as string | null,
    suggested_fix: r.suggested_fix as string | null,
    github_issue_url: r.github_issue_url as string | null,
    resolved_at: r.resolved_at as string | null,
    dismissed_reason: r.dismissed_reason as string | null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}
