// =============================================================================
// FOUNDRY — Entitlement to ACT (owner decision: read-only when unpaid)
//
// Cancelling a subscription stops Foundry acting. A founder who never
// subscribed, or whose trial expired without converting, was indistinguishable
// from a paying customer to every capability gate: `scp_status` stayed 'active'
// from onboarding, `tier` was NULL, and nothing anywhere read trial expiry. So
// the agents kept running, governed effects kept sending, and AI spend kept
// being incurred — indefinitely, for an account that would never pay.
//
// The owner's decision: such an account is READ-ONLY. Its data and history stay
// readable; Foundry stops spending money and stops reaching the outside world
// on its behalf.
//
// HOW, AND WHY THIS WAY. This does not add a second pause mechanism. It writes
// the SAME `products.scp_status = 'paused'` that `customer.subscription.deleted`
// already writes, so every check that already honours a cancellation honours a
// lapsed trial too — the SCP scheduler's `scp_status = 'active'` filters, the
// governed-effect authority read, and everything downstream of them. A second
// mechanism would be a second thing to keep in agreement, and this codebase has
// spent a lot of this campaign finding pairs that stopped agreeing.
//
// WHAT IT IS NOT. Not a revocation. `autonomy_consents` are untouched, no
// responsibility is demoted, and nothing is deleted. Subscribing lifts the
// pause and the permission the founder already gave is still theirs — the same
// distinction the cancellation fix preserves, because "you stopped paying" and
// "you withdrew permission" are different facts.
// =============================================================================

import { query } from '../../db/client.js';
import { getTrialStatus } from './trial.js';

/** A founder may have Foundry act for them when they are paying, or inside a
 * live trial. Everything else is read-only. */
export function entitledToAct(
  tier: string | null | undefined,
  trialEndsAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (tier) return true;
  return getTrialStatus(trialEndsAt, tier, now).onTrial;
}

export interface EntitlementSweep {
  paused: string[];
  resumed: string[];
}

/**
 * Bring every product's pause state into line with its owner's entitlement.
 *
 * Both directions, deliberately. A sweep that only pauses would leave a founder
 * who subscribes after a lapse stuck read-only until somebody noticed — which
 * is the failure mode of every one-way enforcement, and a worse product than
 * not enforcing at all.
 *
 * A product paused for any OTHER reason is left alone: this only resumes ones
 * it can see a reason to resume, and it never touches `products.status`, which
 * is the archive/delete axis and belongs to a different concern.
 */
export async function sweepEntitlements(now: Date = new Date()): Promise<EntitlementSweep> {
  const rows = await query(
    `SELECT p.id, p.scp_status, f.tier, f.trial_ends_at
       FROM products p JOIN founders f ON f.id = p.owner_id
      WHERE COALESCE(p.status,'active') = 'active'`, []);

  const paused: string[] = [];
  const resumed: string[] = [];
  for (const raw of rows.rows as unknown as Array<Record<string, unknown>>) {
    const productId = String(raw.id);
    const scpStatus = String(raw.scp_status ?? '');
    const mayAct = entitledToAct(
      raw.tier as string | null, raw.trial_ends_at as string | null, now);

    if (!mayAct && scpStatus === 'active') {
      await query("UPDATE products SET scp_status='paused' WHERE id=?", [productId]);
      paused.push(productId);
    } else if (mayAct && scpStatus === 'paused') {
      // Only a product this sweep would itself have paused is resumed, which is
      // exactly one that is now entitled. A pause set by an operator for a
      // different reason is not visible here and is not undone by accident.
      await query("UPDATE products SET scp_status='active' WHERE id=?", [productId]);
      resumed.push(productId);
    }
  }
  return { paused, resumed };
}
