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
// ASKED THROUGH ONE ACCESSOR, NOT ONE TABLE. `getAtRiskCustomers` read
// `customers`, which is written by a session-authenticated route no client
// calls and by the demo seed. The documented external surface a real company
// integrates against — `POST /api/v1/customers`, with issued scoped
// credentials — writes `customer_intelligence`. So a company that reported its
// customers the documented way was invisible to this department, and the
// capability was structurally starved for exactly the companies that
// integrated properly. See `institution/company-customers.ts`.
import { getCustomersAtRisk } from '../institution/company-customers.js';
import { getEffectiveMode } from '../autopilot/policy.js';
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
export function draftCheckIn(
  // NAMED FIELDS RATHER THAN A BAG. This took `Record<string, unknown>` and
  // read `last_active_at`, which is the LEGACY store's column name — so a
  // customer arriving from the reported store produced "I wanted to check in"
  // with the quiet-days sentence silently dropped, because the property simply
  // was not there. A loose type is how a store migration goes quiet instead of
  // failing. `lastActive` accepts either spelling for the fixtures that predate
  // this, and nothing else.
  c: { name?: string | null; lastActiveAt?: string | null; last_active_at?: string | null },
  productName: string,
): { subject: string; body: string } {
  const name = String(c.name ?? '').trim() || 'there';
  const lastActive = c.lastActiveAt ?? c.last_active_at ?? null;
  const daysQuiet = lastActive
    ? Math.max(0, Math.floor((Date.now() - new Date(String(lastActive)).getTime()) / 86_400_000))
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
  const mode = await getEffectiveMode(productId, CATEGORY); // platform-capped

  const productRow = (await query('SELECT name FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, string> | undefined;
  const productName = productRow?.name ?? 'our product';

  const atRisk = (await getCustomersAtRisk(productId))
    .filter((c) => typeof c.email === 'string' && String(c.email).includes('@'))
    .slice(0, MAX_PER_SWEEP);

  const result: SuccessSweepResult = { atRisk: atRisk.length, shadowed: 0, proposed: 0, sent: 0, skipped: 0 };

  for (const c of atRisk) {
    const customerId = String(c.id);
    if (await recentlyContacted(productId, customerId)) { result.skipped++; continue; }

    if (mode === 'shadow') {
      // Watching only: record what it WOULD have done — this is the record
      // that later earns 'suggest'.
      await insertAuditLog({
        id: nanoid(),
        product_id: productId,
        action_type: 'dept:customer_success',
        gate: 0,
        trigger: 'customer_success_sweep',
        reasoning: `shadow: would draft a check-in for ${String(c.name ?? c.email)} (churn risk ${Number(c.churnRisk).toFixed(2)})`,
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
    const budget = await checkAndIncrement(productId, String(c.externalId ?? customerId), weekStarting());
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

    // Consent gate (Protective Wrapper): no autonomous act without a live,
    // recorded consent — even if the policy row says 'act'. Absent consent
    // downgrades safely to a proposal.
    const { activeConsent } = await import('../autopilot/consent.js');
    const consent = mode === 'act' ? await activeConsent(productId, CATEGORY) : null;

    if (mode === 'act' && consent) {
      // THE BOUNDARY MAY REFUSE, AND THIS USED TO COUNT THE REFUSAL AS A SEND.
      // The result was discarded and `sent` incremented unconditionally, so a
      // company with no sender of record, a paused subscription, or a customer
      // who had asked not to be contacted still read "sent" in the letter and
      // still had an attribution entry saying Foundry wrote to them on the
      // founder's behalf. A refused effect is a proposal that did not happen.
      const outcome = await approveAndExecute(execId, 'autopilot:customer_success');
      if (!outcome.success) {
        log.warn('customer success send refused at the boundary',
          { productId, executionId: execId, error: outcome.error });
        result.proposed++;
        continue;
      }
      // Verified action (Jarvis axis 1): declare what success means BEFORE
      // the consequences arrive. The independent sweep checks in 7 days;
      // failure logs a defect AND demotes this category one rung.
      const { declareCriteria } = await import('../outbound/action-verifier.js');
      await declareCriteria(execId, [
        { kind: 'provider_accepted' },
        { kind: 'no_error_recorded' },
        {
          kind: 'customer_health_not_worse',
          customer_id: customerId,
          baseline_health: c.healthScore,
        },
      ], 7 * 24);
      // Per-action attribution (primitive 3): the disclosed-agent paper trail —
      // what was done, under whose authority, under which consent/disclosure.
      await insertAuditLog({
        id: nanoid(),
        product_id: productId,
        action_type: 'attribution:customer_success',
        gate: 0,
        trigger: `autopilot acted under effective mode 'act'`,
        reasoning: `Foundry sent a check-in on the founder's behalf under consent ${consent.id} (disclosure ${consent.disclosure_version})`,
        input_context: JSON.stringify({ execution_id: execId, consent_id: consent.id, customer_id: customerId }),
        output: undefined,
        outcome: 'allowed',
      });
      result.sent++;
    } else {
      result.proposed++; // 'suggest', or 'act' without consent — waits for the founder
    }
  }

  if (result.atRisk > 0) {
    log.info('customer success sweep', { productId, ...result, mode: mode });
  }
  return result;
}
