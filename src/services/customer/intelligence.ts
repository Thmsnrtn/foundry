// =============================================================================
// FOUNDRY — Customer Intelligence Service
// Upserts customer records, computes health scores, manages lifecycle stages.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerRecord {
  id: string;
  product_id: string;
  external_customer_id: string;
  account_name: string | null;
  email: string | null;
  stage: string;
  stage_entered_at: string;
  health_score: number;
  login_frequency_score: number;
  feature_depth_score: number;
  support_sentiment_score: number;
  billing_health_score: number;
  engagement_trend: string;
  primary_use_case: string | null;
  features_used: string[];
  activation_complete: boolean;
  last_active_at: string | null;
  mrr_cents: number;
  plan: string | null;
  expansion_eligible: boolean;
  upsell_signals: string[];
  last_contacted_at: string | null;
  last_contacted_by: string | null;
  agent_notes: Array<{ agent: string; note: string; timestamp: string }>;
  created_at: string;
  updated_at: string;
}

// ─── Internal row → typed record ─────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): CustomerRecord {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    external_customer_id: row.external_customer_id as string,
    account_name: (row.account_name as string) ?? null,
    email: (row.email as string) ?? null,
    stage: (row.stage as string) ?? 'trial',
    stage_entered_at: row.stage_entered_at as string,
    health_score: (row.health_score as number) ?? 50,
    login_frequency_score: (row.login_frequency_score as number) ?? 50,
    feature_depth_score: (row.feature_depth_score as number) ?? 50,
    support_sentiment_score: (row.support_sentiment_score as number) ?? 50,
    billing_health_score: (row.billing_health_score as number) ?? 100,
    engagement_trend: (row.engagement_trend as string) ?? 'stable',
    primary_use_case: (row.primary_use_case as string) ?? null,
    features_used: parseJson<string[]>(row.features_used as string, []),
    activation_complete: (row.activation_complete as number) === 1,
    last_active_at: (row.last_active_at as string) ?? null,
    mrr_cents: (row.mrr_cents as number) ?? 0,
    plan: (row.plan as string) ?? null,
    expansion_eligible: (row.expansion_eligible as number) === 1,
    upsell_signals: parseJson<string[]>(row.upsell_signals as string, []),
    last_contacted_at: (row.last_contacted_at as string) ?? null,
    last_contacted_by: (row.last_contacted_by as string) ?? null,
    agent_notes: parseJson<Array<{ agent: string; note: string; timestamp: string }>>(
      row.agent_notes as string,
      []
    ),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ─── computeHealthScore ────────────────────────────────────────────────────────

/**
 * Compute composite health score from sub-scores.
 * Weighted: login 30%, feature 30%, sentiment 25%, billing 15%
 */
export function computeHealthScore(scores: {
  login_frequency: number;
  feature_depth: number;
  support_sentiment: number;
  billing_health: number;
}): number {
  const composite =
    scores.login_frequency * 0.3 +
    scores.feature_depth * 0.3 +
    scores.support_sentiment * 0.25 +
    scores.billing_health * 0.15;
  return Math.round(composite * 10) / 10;
}

// ─── upsertCustomer: DELETED ──────────────────────────────────────────────────
//
// It created a customer record — account name, email, plan, MRR, stage 'trial',
// health 50 — from whatever its caller handed it, and its only caller was the
// agent runner passing a model's parsed JSON. Deleting it removes the door
// rather than posting a sign on it. `recordAgentCustomerSignal` below is what
// an agent may do; `api/v1/customers.ts` is how a real customer arrives, from a
// real system holding a scoped credential.

// ─── updateHealthScore ────────────────────────────────────────────────────────

export async function updateHealthScore(
  customerId: string,
  scores: {
    login_frequency_score?: number;
    feature_depth_score?: number;
    support_sentiment_score?: number;
    billing_health_score?: number;
  }
): Promise<void> {
  // Fetch current scores
  const result = await query(
    `SELECT login_frequency_score, feature_depth_score, support_sentiment_score, billing_health_score
     FROM customer_intelligence WHERE id = ?`,
    [customerId]
  );
  if (result.rows.length === 0) return;

  const row = result.rows[0] as Record<string, unknown>;
  const loginFreq = scores.login_frequency_score ?? (row.login_frequency_score as number);
  const featureDepth = scores.feature_depth_score ?? (row.feature_depth_score as number);
  const supportSentiment = scores.support_sentiment_score ?? (row.support_sentiment_score as number);
  const billingHealth = scores.billing_health_score ?? (row.billing_health_score as number);

  const newHealth = computeHealthScore({
    login_frequency: loginFreq,
    feature_depth: featureDepth,
    support_sentiment: supportSentiment,
    billing_health: billingHealth,
  });

  await query(
    `UPDATE customer_intelligence
     SET login_frequency_score = ?,
         feature_depth_score = ?,
         support_sentiment_score = ?,
         billing_health_score = ?,
         health_score = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [loginFreq, featureDepth, supportSentiment, billingHealth, newHealth, customerId]
  );
}

// ─── transitionStage ──────────────────────────────────────────────────────────

export async function transitionStage(customerId: string, newStage: string): Promise<void> {
  await query(
    `UPDATE customer_intelligence
     SET stage = ?,
         stage_entered_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    [newStage, customerId]
  );
}

// ─── addAgentNote ──────────────────────────────────────────────────────────────

export async function addAgentNote(
  customerId: string,
  agentName: string,
  note: string
): Promise<void> {
  const result = await query(
    `SELECT agent_notes FROM customer_intelligence WHERE id = ?`,
    [customerId]
  );
  if (result.rows.length === 0) return;

  const row = result.rows[0] as Record<string, unknown>;
  const notes = parseJson<Array<{ agent: string; note: string; timestamp: string }>>(
    row.agent_notes as string,
    []
  );

  notes.unshift({
    agent: agentName,
    note,
    timestamp: new Date().toISOString(),
  });

  // A NOTE IS NOT A CONTACT. This also stamped `last_contacted_at` and
  // `last_contacted_by` — columns migration 022 files under "Communication" —
  // for a function whose entire body reads and rewrites `agent_notes`. Nothing
  // is sent, queued or executed anywhere above this line.
  //
  // So a model forming a private opinion about a customer marked that customer
  // as having been written to, by a named agent, on a date. `GET /api/v1/
  // customers/:customerId` serves the row to an external integrator holding a
  // scoped credential — likely syncing into a CRM — who reads "last contacted
  // today by harbor" for someone nobody wrote to. The sharpest case was
  // `lifecycle.ts`, where the branch whose note SAYS "nothing was done" stamped
  // a contact through this same function.
  await query(
    `UPDATE customer_intelligence
     SET agent_notes = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(notes), customerId]
  );
}

// ─── getCustomersByStage ──────────────────────────────────────────────────────

export async function getCustomersByStage(
  productId: string,
  stage?: string
): Promise<CustomerRecord[]> {
  let sql = `SELECT * FROM customer_intelligence WHERE product_id = ?`;
  const args: unknown[] = [productId];

  if (stage) {
    sql += ` AND stage = ?`;
    args.push(stage);
  }

  sql += ` ORDER BY health_score ASC`;

  const result = await query(sql, args);
  return (result.rows as unknown as Array<Record<string, unknown>>).map(rowToRecord);
}

// ─── getAtRiskCustomers ───────────────────────────────────────────────────────

export async function getAtRiskCustomers(productId: string): Promise<CustomerRecord[]> {
  const result = await query(
    `SELECT * FROM customer_intelligence
     WHERE product_id = ? AND health_score < 40
     ORDER BY health_score ASC`,
    [productId]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map(rowToRecord);
}

// ─── getLifecycleSummary ──────────────────────────────────────────────────────

export async function getLifecycleSummary(productId: string): Promise<{
  total: number;
  by_stage: Record<string, number>;
  avg_health: number;
  at_risk_count: number;
  expansion_eligible_count: number;
  total_mrr_cents: number;
}> {
  const [countsResult, summaryResult] = await Promise.all([
    query(
      `SELECT stage, COUNT(*) as cnt FROM customer_intelligence
       WHERE product_id = ? GROUP BY stage`,
      [productId]
    ),
    query(
      `SELECT
         COUNT(*) as total,
         AVG(health_score) as avg_health,
         SUM(CASE WHEN health_score < 40 THEN 1 ELSE 0 END) as at_risk,
         SUM(CASE WHEN expansion_eligible = 1 THEN 1 ELSE 0 END) as expansion_eligible,
         SUM(mrr_cents) as total_mrr
       FROM customer_intelligence WHERE product_id = ?`,
      [productId]
    ),
  ]);

  const by_stage: Record<string, number> = {};
  for (const row of countsResult.rows as unknown as Array<Record<string, unknown>>) {
    by_stage[row.stage as string] = row.cnt as number;
  }

  const s = (summaryResult.rows[0] as Record<string, unknown> | undefined) ?? {};

  return {
    total: (s.total as number) ?? 0,
    by_stage,
    avg_health: Math.round(((s.avg_health as number) ?? 0) * 10) / 10,
    at_risk_count: (s.at_risk as number) ?? 0,
    expansion_eligible_count: (s.expansion_eligible as number) ?? 0,
    total_mrr_cents: (s.total_mrr as number) ?? 0,
  };
}

// ─── getCustomer ──────────────────────────────────────────────────────────────

export async function getCustomer(
  productId: string,
  externalId: string
): Promise<CustomerRecord | null> {
  const result = await query(
    `SELECT * FROM customer_intelligence WHERE product_id = ? AND external_customer_id = ?`,
    [productId, externalId]
  );
  if (result.rows.length === 0) return null;
  return rowToRecord(result.rows[0] as Record<string, unknown>);
}

// ─── recordAgentCustomerSignal ────────────────────────────────────────────────

/**
 * A MODEL MAY JUDGE A CUSTOMER. IT MAY NOT INVENT ONE.
 *
 * `harbor.ts` parses an LLM response and maps `parsed.customer_signals` into
 * `CustomerSignal[]` — `external_id`, `name`, `email`, and four health
 * sub-scores, every field of it produced by a model. The agent runner then fed
 * that straight into `upsertCustomer`, whose insert branch CREATES a customer:
 * an account name, an email address, a plan, an MRR figure, `stage='trial'` and
 * a starting health score of 50, written into `customer_intelligence` with
 * nothing on the row to say where it came from.
 *
 * The other writer of that table is `api/v1/customers.ts` — a scoped external
 * credential reporting a real customer from a real system. Both landed in the
 * same shape, so nothing downstream could tell them apart: the priority ranker,
 * the strategy synthesis and the accuracy tracker all read those rows as the
 * company's customers.
 *
 * FOUNDRY MAY CREATE PRESENTATION. IT MAY NOT FABRICATE EVIDENCE. A customer is
 * a fact about the world — it is reported by a system that has one, or by a
 * person. So this resolves an EXISTING customer and refuses otherwise, and it
 * writes only the fields that are a judgment:
 *
 *   • the four health sub-scores, which are an assessment and say so;
 *   • a note, which is attributed to the agent that wrote it.
 *
 * It never writes identity or money — `account_name`, `email`, `plan`,
 * `mrr_cents`, `stage`. Those are facts, and a model updating an MRR figure is
 * fabricating evidence about revenue as surely as inventing the customer was.
 *
 * A REFUSAL IS NOT SILENCE. It lands in `agent_audit_log`, which the founder's
 * audit page reads, because an agent repeatedly naming customers the company
 * does not have is worth somebody knowing.
 */
export type AgentCustomerSignalRefusal = 'external_id_missing' | 'no_such_customer';

export async function recordAgentCustomerSignal(
  productId: string,
  agentName: string,
  signal: {
    external_id?: string;
    note?: string;
    health_login_score?: number;
    health_feature_score?: number;
    health_sentiment_score?: number;
    health_billing_score?: number;
  },
): Promise<{ recorded: true; customerId: string } | { refused: AgentCustomerSignalRefusal }> {
  const externalId = (signal.external_id ?? '').trim();
  if (!externalId) return { refused: 'external_id_missing' };

  const existing = await query(
    `SELECT id FROM customer_intelligence WHERE product_id = ? AND external_customer_id = ?`,
    [productId, externalId],
  );
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    const { logAudit } = await import('../audit/log.js');
    await logAudit({
      product_id: productId,
      actor_type: 'agent',
      actor_id: agentName,
      action: 'customer_signal.refused',
      resource_type: 'customer_intelligence',
      resource_id: externalId,
      details: {
        reason: 'no_such_customer',
        // What the agent claimed, kept so a founder can see what was refused
        // rather than only that something was. It is not written to the
        // customer record, which is the whole point.
        claimed_external_id: externalId,
      },
    });
    return { refused: 'no_such_customer' };
  }

  const customerId = String(row.id);
  const hasScore = signal.health_login_score !== undefined
    || signal.health_feature_score !== undefined
    || signal.health_sentiment_score !== undefined
    || signal.health_billing_score !== undefined;
  if (hasScore) {
    await updateHealthScore(customerId, {
      login_frequency_score: signal.health_login_score,
      feature_depth_score: signal.health_feature_score,
      support_sentiment_score: signal.health_sentiment_score,
      billing_health_score: signal.health_billing_score,
    });
  }
  if (signal.note) await addAgentNote(customerId, agentName, signal.note);
  return { recorded: true, customerId };
}
