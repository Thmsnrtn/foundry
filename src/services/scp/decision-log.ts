// =============================================================================
// FOUNDRY — Strategic Decision Log Service
// Tracks significant company decisions and supports 90-day retrospective scoring.
// Based on migration 026 (strategic_decisions_log table).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategicDecision {
  id: string;
  product_id: string;
  decision_title: string;
  decision_description: string;
  decision_rationale: string | null;
  expected_outcome: string | null;
  decision_category: 'pricing' | 'product' | 'hiring' | 'marketing' | 'fundraising' | 'operations' | 'technology' | 'customer' | 'partnership' | 'other';
  made_by: 'founder' | 'agent_recommendation' | 'team';
  confidence_at_decision: number | null; // 1-5
  status: 'active' | 'reversed' | 'succeeded' | 'failed' | 'inconclusive';
  retrospective_score: number | null; // 1-5
  retrospective_notes: string | null;
  retrospective_due_at: string | null;
  actual_outcome: string | null;
  agent_context: Record<string, string>;
  made_at: string;
  alternatives_considered: string[];
  key_assumptions: string[];
}

export interface CreateDecisionInput {
  decision_title: string;
  decision_description: string;
  decision_rationale?: string;
  expected_outcome?: string;
  decision_category: StrategicDecision['decision_category'];
  made_by: StrategicDecision['made_by'];
  confidence_at_decision?: number;
  alternatives_considered?: string[];
  key_assumptions?: string[];
  agent_context?: Record<string, string>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createDecision(
  productId: string,
  input: CreateDecisionInput
): Promise<string> {
  const id = nanoid();
  const retrospectiveDue = new Date(Date.now() + 90 * 86400 * 1000).toISOString();

  await query(
    `INSERT INTO strategic_decisions_log (
      id, product_id, decision_title, decision_description, decision_rationale,
      expected_outcome, decision_category, made_by, confidence_at_decision,
      status, agent_context_json, made_at, retrospective_due_at,
      alternatives_considered_json, key_assumptions_json
    ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,datetime('now'),?,?,?)`,
    [
      id, productId,
      input.decision_title, input.decision_description,
      input.decision_rationale ?? null, input.expected_outcome ?? null,
      input.decision_category, input.made_by,
      input.confidence_at_decision ?? null,
      JSON.stringify(input.agent_context ?? {}),
      retrospectiveDue,
      JSON.stringify(input.alternatives_considered ?? []),
      JSON.stringify(input.key_assumptions ?? []),
    ]
  );

  return id;
}

export async function getDecision(decisionId: string): Promise<StrategicDecision | null> {
  const result = await query(
    `SELECT * FROM strategic_decisions_log WHERE id=?`,
    [decisionId]
  );
  if (result.rows.length === 0) return null;
  return parseDecisionRow(result.rows[0] as Record<string, unknown>);
}

export async function listDecisions(
  productId: string,
  opts?: { status?: string; category?: string; limit?: number; offset?: number }
): Promise<{ decisions: StrategicDecision[]; total: number }> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;

  let where = 'product_id=?';
  const params: unknown[] = [productId];

  if (opts?.status) { where += ' AND status=?'; params.push(opts.status); }
  if (opts?.category) { where += ' AND decision_category=?'; params.push(opts.category); }

  const [rows, count] = await Promise.all([
    query(`SELECT * FROM strategic_decisions_log WHERE ${where} ORDER BY made_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    query(`SELECT COUNT(*) as c FROM strategic_decisions_log WHERE ${where}`, params),
  ]);

  return {
    decisions: rows.rows.map(r => parseDecisionRow(r as Record<string, unknown>)),
    total: Number((count.rows[0] as Record<string, unknown>)?.c ?? 0),
  };
}

export async function updateDecisionStatus(
  decisionId: string,
  status: StrategicDecision['status']
): Promise<void> {
  await query(
    `UPDATE strategic_decisions_log SET status=? WHERE id=?`,
    [status, decisionId]
  );
}

export async function recordRetrospective(
  decisionId: string,
  opts: {
    retrospective_score: number; // 1-5
    retrospective_notes: string;
    actual_outcome: string;
    status?: StrategicDecision['status'];
  }
): Promise<void> {
  await query(
    `UPDATE strategic_decisions_log SET
      retrospective_score=?, retrospective_notes=?, actual_outcome=?,
      status=COALESCE(?, status)
     WHERE id=?`,
    [
      opts.retrospective_score, opts.retrospective_notes, opts.actual_outcome,
      opts.status ?? null, decisionId,
    ]
  );
}

export async function getDecisionsDueForRetrospective(productId: string): Promise<StrategicDecision[]> {
  const result = await query(
    `SELECT * FROM strategic_decisions_log
     WHERE product_id=? AND status='active'
       AND retrospective_due_at <= datetime('now')
       AND retrospective_score IS NULL
     ORDER BY retrospective_due_at ASC
     LIMIT 10`,
    [productId]
  );
  return result.rows.map(r => parseDecisionRow(r as Record<string, unknown>));
}

export async function getDecisionStats(productId: string): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  avg_confidence: number | null;
  avg_retrospective_score: number | null;
}> {
  const result = await query(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) as succeeded,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
      AVG(confidence_at_decision) as avg_confidence,
      AVG(retrospective_score) as avg_retro_score
     FROM strategic_decisions_log WHERE product_id=?`,
    [productId]
  );

  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return {
    total: Number(row.total ?? 0),
    succeeded: Number(row.succeeded ?? 0),
    failed: Number(row.failed ?? 0),
    active: Number(row.active ?? 0),
    avg_confidence: row.avg_confidence != null ? Number(row.avg_confidence) : null,
    avg_retrospective_score: row.avg_retro_score != null ? Number(row.avg_retro_score) : null,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function parseDecisionRow(row: Record<string, unknown>): StrategicDecision {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    decision_title: row.decision_title as string,
    decision_description: row.decision_description as string,
    decision_rationale: (row.decision_rationale as string) ?? null,
    expected_outcome: (row.expected_outcome as string) ?? null,
    decision_category: row.decision_category as StrategicDecision['decision_category'],
    made_by: row.made_by as StrategicDecision['made_by'],
    confidence_at_decision: row.confidence_at_decision != null ? Number(row.confidence_at_decision) : null,
    status: row.status as StrategicDecision['status'],
    retrospective_score: row.retrospective_score != null ? Number(row.retrospective_score) : null,
    retrospective_notes: (row.retrospective_notes as string) ?? null,
    retrospective_due_at: (row.retrospective_due_at as string) ?? null,
    actual_outcome: (row.actual_outcome as string) ?? null,
    agent_context: (() => { try { return JSON.parse(row.agent_context_json as string || '{}'); } catch { return {}; } })(),
    made_at: row.made_at as string,
    alternatives_considered: (() => { try { return JSON.parse(row.alternatives_considered_json as string || '[]'); } catch { return []; } })(),
    key_assumptions: (() => { try { return JSON.parse(row.key_assumptions_json as string || '[]'); } catch { return []; } })(),
  };
}
