// =============================================================================
// FOUNDRY — Outreach: the fourth department, on the SLOWEST ladder (Hands Law)
//
// The most powerful department and the most dangerous, so v1 is deliberately
// narrow: REFERRAL asks to champions the ledger actually knows — customers
// whose real health and tenure earned the label — never cold strangers. Cold
// prospecting stays out until a founder connects a prospecting tool AND the
// trust machinery has a record here.
//
// Hard rails, none removable by trust:
//   1. Suppression list — an address there is never contacted, by any mode.
//   2. No auto-send — 'act' mode still queues for founder approval in v1.
//      Sending without a human eye is not on this ladder yet, on purpose.
//   3. Envelope + per-customer budget + 30-day dedup.
//   4. Drafts state only what the ledger holds (champion = real health score).
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { getEffectiveMode } from '../autopilot/policy.js';
import { createExecution } from '../scp/actions/executor.js';
import { checkAndConsume, weekStarting } from '../outbound/envelopes.js';
import { checkAndIncrement } from '../outbound/budget.js';
import { ensurePolicyVisible, recordShadowWork } from './shared.js';
import { log } from '../../lib/logger.js';

export const CATEGORY = 'outreach';
const ENVELOPE_SCOPE = 'dept:outreach';
const DEDUP_DAYS = 30;
const MAX_PER_SWEEP = 2;

export interface OutreachSweepResult {
  champions: number;
  shadowed: number;
  proposed: number;
  skipped: number;
  suppressed: number;
}

export async function addSuppression(productId: string, email: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO outreach_suppressions (id, product_id, email, reason)
     VALUES (?, ?, ?, ?) ON CONFLICT(product_id, email) DO NOTHING`,
    [nanoid(), productId, email.toLowerCase().trim(), reason],
  );
}

export async function isSuppressed(productId: string, email: string): Promise<boolean> {
  const r = await query(
    'SELECT id FROM outreach_suppressions WHERE product_id = ? AND email = ?',
    [productId, email.toLowerCase().trim()],
  );
  return r.rows.length > 0;
}

/** A referral ask that earns its warmth: it names only what is true — the
 *  customer's actual standing — and asks one small, specific favor. */
export function draftReferralAsk(c: Record<string, unknown>, productName: string): { subject: string; body: string } {
  const name = String(c.name ?? '').trim() || 'there';
  return {
    subject: `A small favor — and thank you`,
    body: [
      `Hi ${name},`,
      '',
      `You're one of the people getting the most out of ${productName}, and that means a lot — thank you.`,
      `A small favor: if you know one founder who'd benefit the way you have, would you introduce us? A one-line forward of this email is plenty.`,
      '',
      `Either way — thanks for being here.`,
    ].join('\n'),
  };
}

async function recentlyAsked(productId: string, customerId: string): Promise<boolean> {
  const r = await query(
    `SELECT id FROM action_executions
     WHERE product_id = ? AND action_type = 'send_email'
       AND payload_json LIKE ? AND created_at >= datetime('now', '-${DEDUP_DAYS} days')
       AND status != 'cancelled' LIMIT 1`,
    [productId, `%"outreach_customer":"${customerId}"%`],
  );
  return r.rows.length > 0;
}

export async function runOutreachSweep(productId: string): Promise<OutreachSweepResult> {
  await ensurePolicyVisible(productId, CATEGORY);
  const mode = await getEffectiveMode(productId, CATEGORY); // platform-capped

  const productRow = (await query('SELECT name FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, string> | undefined;
  const productName = productRow?.name ?? 'our product';

  const champions = (await query(
    `SELECT * FROM customers WHERE product_id = ? AND is_champion = 1
       AND email LIKE '%@%' ORDER BY health_score DESC LIMIT ?`,
    [productId, MAX_PER_SWEEP],
  )).rows as unknown as Array<Record<string, unknown>>;

  const result: OutreachSweepResult = { champions: champions.length, shadowed: 0, proposed: 0, skipped: 0, suppressed: 0 };

  for (const c of champions) {
    const customerId = String(c.id);
    const email = String(c.email);

    // Rail 1: suppression beats everything.
    if (await isSuppressed(productId, email)) { result.suppressed++; continue; }
    if (await recentlyAsked(productId, customerId)) { result.skipped++; continue; }

    if (mode === 'shadow') {
      await recordShadowWork(
        productId, CATEGORY,
        `shadow: would draft a referral ask for champion ${String(c.name ?? email)}`,
        { customer_id: customerId },
      );
      result.shadowed++;
      continue;
    }

    const envelope = await checkAndConsume(productId, ENVELOPE_SCOPE);
    if (!envelope.allowed) { result.skipped++; continue; }
    const budget = await checkAndIncrement(productId, String(c.external_id ?? customerId), weekStarting());
    if (!budget.allowed) { result.skipped++; continue; }

    const draft = draftReferralAsk(c, productName);
    await createExecution(productId, null, {
      action_type: 'send_email',
      integration: 'resend',
      to_email: email,
      subject: draft.subject,
      body: draft.body,
      outreach_customer: customerId,
    });
    // Rail 2: 'act' does NOT auto-send here. Outreach earns autonomy last,
    // and v1 keeps a human eye on every send regardless of mode.
    result.proposed++;
  }

  if (result.champions > 0) {
    log.info('outreach sweep', { productId, ...result, mode: mode });
  }
  return result;
}
