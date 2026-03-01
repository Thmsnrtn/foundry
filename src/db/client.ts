// =============================================================================
// FOUNDRY — Turso Database Client
// Multi-tenant by design. Every query scopes by founder ID.
// =============================================================================

import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is required');

    _client = createClient({
      url,
      authToken: authToken || undefined,
    });
  }
  return _client;
}

/**
 * Execute a query and return the result set.
 */
export async function query(sql: string, args: unknown[] = []): Promise<ResultSet> {
  const db = getDb();
  return db.execute({ sql, args: args as any[] });
}

/**
 * Execute a batch of statements in a transaction.
 */
export async function batch(statements: Array<{ sql: string; args?: unknown[] }>): Promise<ResultSet[]> {
  const db = getDb();
  return db.batch(
    statements.map((s) => ({
      sql: s.sql,
      args: (s.args || []) as any[],
    })),
    'write'
  );
}

/**
 * Execute raw SQL (used for migrations).
 * Splits on statement-ending semicolons (semicolons followed by a newline)
 * to avoid breaking on semicolons inside CHECK/IN constraints.
 */
export async function executeRaw(sql: string): Promise<void> {
  const db = getDb();
  // Split on semicolons that are followed by a newline (statement boundaries),
  // not semicolons inside parenthesized expressions.
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.replace(/--[^\n]*/g, '').trim())
    .filter(s => s.length > 0);
  for (const stmt of statements) {
    await db.execute({ sql: stmt, args: [] });
  }
}

// ─── Multi-Tenant Query Helpers ──────────────────────────────────────────────
// These enforce tenant isolation at the query layer.

/**
 * Get all products owned by a founder.
 */
export async function getProductsByOwner(founderId: string): Promise<ResultSet> {
  return query('SELECT * FROM products WHERE owner_id = ? AND status != ?', [founderId, 'archived']);
}

/**
 * Get a specific product, scoped to founder ownership.
 * Returns null row if not found (returns 404, not 403 — no info leak).
 */
export async function getProductByOwner(productId: string, founderId: string): Promise<ResultSet> {
  return query('SELECT * FROM products WHERE id = ? AND owner_id = ?', [productId, founderId]);
}

/**
 * Get lifecycle state for a product (ownership must be verified beforehand).
 */
export async function getLifecycleState(productId: string): Promise<ResultSet> {
  return query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
}

/**
 * Get the most recent audit for a product.
 */
export async function getLatestAudit(productId: string): Promise<ResultSet> {
  return query(
    'SELECT * FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [productId]
  );
}

/**
 * Get the previous audit (for comparison).
 */
export async function getPriorAudit(productId: string, currentAuditId: string): Promise<ResultSet> {
  return query(
    'SELECT * FROM audit_scores WHERE product_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1',
    [productId, currentAuditId]
  );
}

/**
 * Get pending decisions for a product, ordered by category urgency.
 */
export async function getPendingDecisions(productId: string): Promise<ResultSet> {
  return query(
    `SELECT * FROM decisions WHERE product_id = ? AND status = 'pending'
     ORDER BY CASE category
       WHEN 'urgent' THEN 1
       WHEN 'strategic' THEN 2
       WHEN 'product' THEN 3
       WHEN 'marketing' THEN 4
       WHEN 'informational' THEN 5
     END, created_at ASC`,
    [productId]
  );
}

/**
 * Get active stressors for a product.
 */
export async function getActiveStressors(productId: string): Promise<ResultSet> {
  return query(
    `SELECT * FROM stressor_history WHERE product_id = ? AND status = 'active'
     ORDER BY CASE severity
       WHEN 'critical' THEN 1
       WHEN 'elevated' THEN 2
       WHEN 'watch' THEN 3
     END`,
    [productId]
  );
}

/**
 * Get metric snapshots for a product within a date range.
 */
export async function getMetricSnapshots(
  productId: string,
  startDate: string,
  endDate: string
): Promise<ResultSet> {
  return query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? AND snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date DESC',
    [productId, startDate, endDate]
  );
}

/**
 * Get the latest metric snapshot for a product.
 */
export async function getLatestMetrics(productId: string): Promise<ResultSet> {
  return query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
}

/**
 * Get cohorts for a product.
 */
export async function getCohorts(productId: string): Promise<ResultSet> {
  return query(
    'SELECT * FROM cohorts WHERE product_id = ? ORDER BY acquisition_period DESC',
    [productId]
  );
}

/**
 * Get competitors for a product.
 */
export async function getCompetitors(productId: string): Promise<ResultSet> {
  return query('SELECT * FROM competitors WHERE product_id = ?', [productId]);
}

/**
 * Get competitive signals for a product.
 */
export async function getCompetitiveSignals(
  productId: string,
  limit: number = 20
): Promise<ResultSet> {
  return query(
    'SELECT * FROM competitive_signals WHERE product_id = ? ORDER BY detected_at DESC LIMIT ?',
    [productId, limit]
  );
}

/**
 * Get recent audit log entries for a product.
 */
export async function getAuditLog(productId: string, limit: number = 50): Promise<ResultSet> {
  return query(
    'SELECT * FROM audit_log WHERE product_id = ? ORDER BY created_at DESC LIMIT ?',
    [productId, limit]
  );
}

/**
 * Get scenario models for a decision.
 */
export async function getScenarioModels(decisionId: string): Promise<ResultSet> {
  return query('SELECT * FROM scenario_models WHERE decision_id = ?', [decisionId]);
}

/**
 * Get relevant decision patterns for cross-product learning.
 * This table is intentionally NOT tenant-scoped.
 */
export async function getRelevantPatterns(
  decisionType: string,
  lifecycleStage: string,
  riskState: string,
  marketCategory: string | null,
  limit: number = 5
): Promise<ResultSet> {
  // Match on at least 3 of 5 dimensions (done in application logic after fetching candidates)
  return query(
    `SELECT * FROM decision_patterns
     WHERE (decision_type = ? OR product_lifecycle_stage = ? OR risk_state_at_decision = ? OR market_category = ?)
     AND outcome_direction IS NOT NULL
     ORDER BY created_at DESC LIMIT ?`,
    [decisionType, lifecycleStage, riskState, marketCategory || '', limit * 3]
  );
}

/**
 * Count Gate 0 decisions with outcomes (for Cold Start check).
 */
export async function countGate0DecisionsWithOutcomes(productId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as count FROM audit_log
     WHERE product_id = ? AND gate = 0 AND outcome IS NOT NULL`,
    [productId]
  );
  return (result.rows[0] as Record<string, unknown>)?.count as number ?? 0;
}

/**
 * Get founding story artifacts for a product.
 */
export async function getStoryArtifacts(productId: string): Promise<ResultSet> {
  return query(
    'SELECT * FROM founding_story_artifacts WHERE product_id = ? ORDER BY created_at ASC',
    [productId]
  );
}

/**
 * Get beta intake records for a product.
 */
export async function getBetaIntakes(productId: string): Promise<ResultSet> {
  return query(
    'SELECT * FROM beta_intake WHERE product_id = ? ORDER BY created_at DESC',
    [productId]
  );
}

/**
 * Get lifecycle conditions for a product.
 */
export async function getLifecycleConditions(productId: string): Promise<ResultSet> {
  return query('SELECT * FROM lifecycle_conditions WHERE product_id = ?', [productId]);
}

/**
 * Insert a new audit log entry. Used by every autonomous action and job.
 */
export async function insertAuditLog(entry: {
  id: string;
  product_id: string;
  action_type: string;
  gate: number;
  trigger: string;
  reasoning: string;
  input_context?: string;
  output?: string;
  outcome?: string;
  confidence_score?: number;
  risk_state_at_action?: string;
}): Promise<void> {
  await query(
    `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, input_context, output, outcome, confidence_score, risk_state_at_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.product_id,
      entry.action_type,
      entry.gate,
      entry.trigger,
      entry.reasoning,
      entry.input_context || null,
      entry.output || null,
      entry.outcome || null,
      entry.confidence_score || null,
      entry.risk_state_at_action || null,
    ]
  );
}

/**
 * Get the founder record by Clerk user ID.
 */
export async function getFounderByClerkId(clerkUserId: string): Promise<ResultSet> {
  return query('SELECT * FROM founders WHERE clerk_user_id = ?', [clerkUserId]);
}

/**
 * Get all active products (for scheduled jobs that iterate all products).
 */
export async function getAllActiveProducts(): Promise<ResultSet> {
  return query("SELECT * FROM products WHERE status = 'active'", []);
}
