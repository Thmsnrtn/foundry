// =============================================================================
// FOUNDRY — Turso Database Client
// Multi-tenant by design. Every query scopes by founder ID.
// =============================================================================

import { createClient, type Client, type InStatement, type InValue, type InArgs, type ResultSet } from '@libsql/client';

let _client: Client | null = null;
let _ready: Promise<void> | null = null;

const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '10000', 10);

export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is required');

    _client = createClient({
      url,
      authToken: authToken || undefined,
    });

    // Enable foreign key enforcement — without this, all REFERENCES clauses are
    // decorative. This used to be fire-and-forget, which made enforcement a
    // race: the first statements after client creation could run before the
    // PRAGMA landed, so whether a REFERENCES clause was live depended on
    // scheduling. Every entry point now awaits `ready()` first, so the window
    // is closed by construction rather than by luck.
    _ready = _client.execute('PRAGMA foreign_keys = ON').then(
      () => undefined,
      (err: unknown) => {
        // Some Turso configurations may not support this. It must be visible:
        // running without foreign keys is a real loss of integrity, not a
        // detail to swallow.
        console.warn(`[DB] Could not enable foreign_keys PRAGMA: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }
  return _client;
}

// Readiness is deliberately NOT exported. Every entry point below awaits it, so
// no caller can forget to — and the tenancy gate scans exported client
// functions for tenant scoping, which a connection-lifecycle helper would fail
// for the wrong reason.

/**
 * Execute a query and return the result set.
 * Includes a configurable timeout (default 10s) to prevent hung queries
 * from blocking the event loop indefinitely.
 */
export async function query(sql: string, args: unknown[] = []): Promise<ResultSet> {
  const db = getDb();
  await _ready;
  return Promise.race([
    db.execute({ sql, args: args as InArgs }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`DB query timeout after ${QUERY_TIMEOUT_MS}ms`)), QUERY_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Execute a batch of statements in a transaction.
 */
export async function batch(statements: Array<{ sql: string; args?: unknown[] }>): Promise<ResultSet[]> {
  const db = getDb();
  await _ready;
  return db.batch(
    statements.map((s) => ({
      sql: s.sql,
      args: (s.args || []) as InArgs,
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
  await _ready;
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
 *
 * ACTIVE ON BOTH AXES. `status` says the record exists; `scp_status` says the
 * company is being operated. Thirty-four background jobs choose their work
 * through this one function — competitive scans, daily insight generation,
 * morning briefings, autopilot, customer success — and nearly all of them spend
 * money on model calls per product they are handed.
 *
 * Filtering only on `status` meant a cancelled or read-only company kept being
 * handed to every one of them. The outbound gateway now refuses the resulting
 * effect, but refusing the send after paying for the work is the expensive half
 * of the fix and none of the value: `redDaily` generates an Opus narrative and
 * THEN emails it. The pause has to reach the work.
 *
 * 'provisioning' is deliberately kept. A product is provisioning before its
 * first agent run, and excluding it would stall onboarding to enforce billing.
 */
export async function getAllActiveProducts(): Promise<ResultSet> {
  return query(`SELECT * FROM products WHERE ${operatingProduct()}`, []);
}

/**
 * The SQL predicate for "Foundry is operating this company right now".
 *
 * Exported as one definition rather than copied, because several jobs cannot
 * use `getAllActiveProducts` — they join `founders` or `lifecycle_state` and
 * need the predicate under an alias. Copying it is how the two halves of a rule
 * start to disagree, which is the defect shape this codebase keeps finding.
 *
 * Takes a table alias, never a caller value: it is composed into SQL text, so
 * there is nothing here for a request to reach.
 *
 * COALESCE, not a bare comparison. `scp_status` is NULL on rows older than
 * migration 017, and in SQLite `NULL NOT IN (...)` is NULL, which is not true,
 * which would silently drop every legacy company from every job.
 */
export function operatingProduct(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}status = 'active' AND COALESCE(${p}scp_status,'active') NOT IN ('paused','archived')`;
}
