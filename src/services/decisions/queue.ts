// =============================================================================
// FOUNDRY — Decision Queue Management
// =============================================================================

import { query, getPendingDecisions, insertAuditLog } from '../../db/client.js';
import { generateScenarios } from '../intelligence/scenario.js';
import { nanoid } from 'nanoid';
import type { Decision, DecisionCategory, Gate, RiskStateValue } from '../../types/index.js';
import type { DecisionRow } from '../../types/database.js';

export async function createDecision(input: {
  productId: string;
  category: DecisionCategory;
  gate: Gate;
  what: string;
  whyNow: string;
  context?: unknown[];
  options?: Array<{ label: string; description: string; trade_offs: string }>;
  recommendation?: string;
  impact?: string;
  deadline?: string;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, context, options, recommendation, impact, deadline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.productId, input.category, input.gate, input.what, input.whyNow,
     input.context ? JSON.stringify(input.context) : null,
     input.options ? JSON.stringify(input.options) : null,
     input.recommendation ?? null, input.impact ?? null, input.deadline ?? null]
  );

  // Auto-generate scenarios for Gate 3 decisions
  if (input.gate === 3) {
    // Scenario generation triggered asynchronously
    // In production, this would be queued; here we note it for the job to pick up
  }

  // Phase 4.3: notify configured outbound destinations (Slack/Linear/Notion)
  // when a founder-facing decision (Gate 3+) lands, so founders see it where
  // they already work. Routed through the V3.1 gateway. Fire-and-forget.
  if (input.gate >= 3) {
    void (async () => {
      try {
        const nameRes = await query('SELECT name FROM products WHERE id = ?', [input.productId]);
        const productName = (nameRes.rows[0] as Record<string, string>)?.name ?? 'your product';
        const { dispatchEvent } = await import('../distribution/outbound-webhooks.js');
        await dispatchEvent(input.productId, {
          event_type: 'decision_needed',
          product_id: input.productId,
          product_name: productName,
          headline: `Decision needed for ${productName}: ${input.what}`,
          detail: input.whyNow,
          url: `${process.env.APP_URL ?? ''}/decisions`,
        });
      } catch { /* dispatcher unavailable / no destinations — non-fatal */ }
    })();
  }

  return id;
}

export async function resolveDecision(
  decisionId: string,
  productId: string,
  chosenOption: string,
  decidedBy: string
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `UPDATE decisions
     SET status = 'approved', chosen_option = ?, decided_at = ?, decided_by = ?,
         follow_up_at = datetime('now', '+30 days')
     WHERE id = ? AND product_id = ?`,
    [chosenOption, now, decidedBy, decisionId, productId]
  );

  // Dispatch webhook
  const ownerResult = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
  const ownerId = (ownerResult.rows[0] as Record<string, string>)?.owner_id;
  if (ownerId) {
    const { dispatchWebhook } = await import('../../lib/webhooks.js');
    dispatchWebhook(productId, ownerId, 'decision.resolved', {
      decision_id: decisionId, product_id: productId, chosen_option: chosenOption, decided_by: decidedBy,
    }).catch(() => {});

    // Activation funnel: first decision approved (Phase 5.2).
    void (async () => {
      try {
        const { recordFunnelStep } = await import('../telemetry/funnel.js');
        await recordFunnelStep('decision_approved', { founderId: ownerId, productId });
      } catch { /* non-fatal */ }
    })();
  }
}

export async function recordOutcome(
  decisionId: string,
  productId: string,
  outcome: string,
  valence?: number | null,
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `UPDATE decisions SET outcome = ?, outcome_measured_at = ?, outcome_valence = ? WHERE id = ? AND product_id = ?`,
    [outcome, now, valence ?? null, decisionId, productId]
  );
}

export async function getDecisionQueue(productId: string, riskState: RiskStateValue): Promise<Decision[]> {
  let sql: string;
  if (riskState === 'red') {
    // Red: only urgent and recovery-related decisions
    sql = `SELECT * FROM decisions WHERE product_id = ? AND status = 'pending' AND category = 'urgent' ORDER BY created_at ASC`;
  } else if (riskState === 'yellow') {
    // Yellow: retention-relevant first, flag stale Gate 3
    sql = `SELECT * FROM decisions WHERE product_id = ? AND status = 'pending' ORDER BY
      CASE WHEN category = 'urgent' THEN 0
           WHEN gate = 3 AND created_at < datetime('now', '-7 days') THEN 1
           ELSE 2 END, created_at ASC`;
  } else {
    sql = `SELECT * FROM decisions WHERE product_id = ? AND status = 'pending' ORDER BY
      CASE category WHEN 'urgent' THEN 1 WHEN 'strategic' THEN 2 WHEN 'product' THEN 3 WHEN 'marketing' THEN 4 ELSE 5 END, created_at ASC`;
  }

  const result = await query(sql, [productId]);
  return (result.rows as unknown as DecisionRow[]).map(parseDecisionRow);
}

function parseDecisionRow(row: DecisionRow): Decision {
  return {
    ...row,
    category: row.category as DecisionCategory,
    gate: row.gate as Gate,
    status: row.status as Decision['status'],
    context: row.context ? JSON.parse(row.context) : null,
    options: row.options ? JSON.parse(row.options) : null,
  };
}
