// =============================================================================
// FOUNDRY — Customer Success: the first department (Hands Law layer 3)
//
// The same closed loop as everything else, pointed at retention:
//   sense  — churn risk from real customer telemetry (customers.churn_risk)
//   decide — one save per at-risk customer: a check-in drafted from their
//            REAL account state (deterministic — no model call, no fabrication)
//   act    — through the existing execution engine, governed by the trust
//            ladder: shadow = record what it WOULD do; suggest = draft lands
//            in the founder's approval queue; act = sends autonomously
//            (the founder's explicit grant in Controls)
//   learn  — every save is deduped and budgeted; outcomes feed health history
//   report — completed sends surface in the Letter's "what I handled"
//
// Bounded three ways, no route around: the trust ladder (may it act?), the
// department envelope (how many saves/week total?), and the per-customer
// communication budget (nobody gets nagged).
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { getAtRiskCustomers } from '../customers/intelligence.js';
import { getPolicy } from '../autopilot/policy.js';
import { createExecution, approveAndExecute } from '../scp/actions/executor.js';
import { checkAndConsume, weekStarting } from '../outbound/envelopes.js';
import { checkAndIncrement } from '../outbound/budget.js';
import { insertAuditLog } from '../../db/client.js';
import { log } from '../../lib/logger.js';

export const CATEGORY = 'customer_success';
const ENVELOPE_SCOPE = 'dept:customer_success';
const DEDUP_DAYS = 14;
const MAX_PER_SWEEP = 5;

export interface SuccessSweepResult {
  atRisk: number;
  shadowed: number;
  proposed: number;
  sent: number;
  skipped: number;
}

/** A check-in drafted ONLY from what we actually know about the customer.
 *  Deterministic: it cannot claim anything the ledger doesn't hold. */
export function draftCheckIn(c: Record<string, unknown>, productName: string): { subject: string; body: string } {
  const name = String(c.name ?? '').trim() || 'there';
  const daysQuiet = c.last_active_at
    ? Math.max(0, Math.floor((Date.now() - new Date(String(c.last_active_at)).getTime()) / 86_400_000))
    : null;
  const lines = [
    `Hi ${name},`,
    '',
    daysQuiet != null && daysQuiet > 7
      ? `It's been about ${daysQuiet} days since you were last in ${productName}, and I wanted to check in personally.`
      : `I wanted to check in personally on how ${productName} is working for you.`,
    'Is there anything getting in your way, or anything we could do better? Reply to this email and it comes straight to me.',
    '',
    'Thanks for being here,',
  ];
  return {
    subject: `Quick check-in from ${productName}`,
    body: lines.join('\n'),
  };
}

/** Make the category's dial visible in Controls without overriding any choice
 *  the founder already made. */
async function ensurePolicyVisible(productId: string): Promise<void> {
  await query(
    `INSERT INTO autopilot_policies (id, product_id, category, mode, set_by)
     VALUES (?, ?, ?, 'shadow', 'system_bootstrap')
     ON CONFLICT(product_id, category) DO NOTHING`,
    [nanoid(), productId, CATEGORY],
  );
}

async function recentlyContacted(productId: string, customerId: string): Promise<boolean> {
  const r = await query(
    `SELECT id FROM action_executions
     WHERE product_id = ? AND action_type = 'send_email'
       AND payload_json LIKE ? AND created_at >= datetime('now', '-${DEDUP_DAYS} days')
       AND status != 'cancelled' LIMIT 1`,
    [productId, `%"cs_customer":"${customerId}"%`],
  );
  return r.rows.length > 0;
}

export async function runSuccessSweep(productId: string): Promise<SuccessSweepResult> {
  await ensurePolicyVisible(productId);
  const policy = await getPolicy(productId, CATEGORY);

  const productRow = (await query('SELECT name FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, string> | undefined;
  const productName = productRow?.name ?? 'our product';

  const atRisk = (await getAtRiskCustomers(productId))
    .filter((c) => typeof c.email === 'string' && String(c.email).includes('@'))
    .slice(0, MAX_PER_SWEEP);

  const result: SuccessSweepResult = { atRisk: atRisk.length, shadowed: 0, proposed: 0, sent: 0, skipped: 0 };

  for (const c of atRisk) {
    const customerId = String(c.id);
    if (await recentlyContacted(productId, customerId)) { result.skipped++; continue; }

    if (policy.mode === 'shadow') {
      // Watching only: record what it WOULD have done — this is the record
      // that later earns 'suggest'.
      await insertAuditLog({
        id: nanoid(),
        product_id: productId,
        action_type: 'dept:customer_success',
        gate: 0,
        trigger: 'customer_success_sweep',
        reasoning: `shadow: would draft a check-in for ${String(c.name ?? c.email)} (churn risk ${Number(c.churn_risk).toFixed(2)})`,
        input_context: JSON.stringify({ customer_id: customerId }),
        output: undefined,
        outcome: 'shadow',
      });
      result.shadowed++;
      continue;
    }

    // The department envelope: total saves per week, founder-adjustable.
    const envelope = await checkAndConsume(productId, ENVELOPE_SCOPE);
    if (!envelope.allowed) { result.skipped++; continue; }

    // The per-customer budget: nobody gets nagged (default 3 msgs/week).
    const budget = await checkAndIncrement(productId, String(c.external_id ?? customerId), weekStarting());
    if (!budget.allowed) { result.skipped++; continue; }

    const draft = draftCheckIn(c, productName);
    const execId = await createExecution(productId, null, {
      action_type: 'send_email',
      integration: 'resend',
      to_email: String(c.email),
      subject: draft.subject,
      body: draft.body,
      cs_customer: customerId,
    });

    if (policy.mode === 'act') {
      await approveAndExecute(execId, 'autopilot:customer_success');
      result.sent++;
    } else {
      result.proposed++; // 'suggest' — waits in the founder's approval queue
    }
  }

  if (result.atRisk > 0) {
    log.info('customer success sweep', { productId, ...result, mode: policy.mode });
  }
  return result;
}
