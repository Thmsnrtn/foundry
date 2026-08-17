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

/** What the account looks like to the entitlement rule. */
export interface EntitlementFacts {
  tier: string | null | undefined;
  trialEndsAt: string | null | undefined;
  /** End of the period already paid for — Stripe's `current_period_end`.
   * Survives cancellation on purpose: it is what the founder bought. */
  paidThrough?: string | null | undefined;
}

/**
 * May Foundry act for this founder?
 *
 * Three ways to be entitled, in the order a SaaS account normally acquires
 * them:
 *
 *   • a live trial            — before any money changes hands
 *   • a plan                  — while subscribed
 *   • a paid-through date     — AFTER cancelling, until the period they paid
 *                               for actually ends
 *
 * The third is the ordinary convention and the codebase did not have it. The
 * `customer.subscription.deleted` handler nulled the tier and paused every
 * product in the same breath, so cancelling mid-period ended the service the
 * founder had already been charged for. Nobody does that: cancellation sets a
 * date, and access runs to it.
 *
 * It also gives dunning the right behaviour for free. When an invoice fails,
 * Stripe keeps retrying and has already advanced `current_period_end`, so a
 * past-due account stays live through the retry window instead of being cut off
 * on the first failed charge.
 */
export function entitledToAct(
  facts: EntitlementFacts,
  now: Date = new Date(),
): boolean {
  if (facts.tier) return true;
  if (paidThroughIsLive(facts.paidThrough, now)) return true;
  return getTrialStatus(facts.trialEndsAt, facts.tier, now).onTrial;
}

/** An unparseable date is not an entitlement. Returning true on garbage would
 * make a corrupt row into free service that nothing ever reclaims. */
function paidThroughIsLive(paidThrough: string | null | undefined, now: Date): boolean {
  if (!paidThrough) return false;
  const ends = Date.parse(paidThrough);
  return Number.isFinite(ends) && ends > now.getTime();
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
    `SELECT p.id, p.name, p.scp_status, f.email, f.tier, f.trial_ends_at, f.paid_through
       FROM products p JOIN founders f ON f.id = p.owner_id
      WHERE COALESCE(p.status,'active') = 'active'`, []);

  return applyToRows(rows.rows as unknown as Array<Record<string, unknown>>, now);
}

/** Apply the rule to a set of joined product+founder rows. One implementation,
 * used by the hourly sweep and by the billing webhook, so the two can never
 * decide the same account differently. */
async function applyToRows(
  rows: Array<Record<string, unknown>>, now: Date,
): Promise<EntitlementSweep> {
  const paused: string[] = [];
  const resumed: string[] = [];
  for (const raw of rows) {
    const productId = String(raw.id);
    const scpStatus = String(raw.scp_status ?? '');
    const mayAct = entitledToAct({
      tier: raw.tier as string | null,
      trialEndsAt: raw.trial_ends_at as string | null,
      paidThrough: raw.paid_through as string | null,
    }, now);

    if (!mayAct && scpStatus === 'active') {
      await query("UPDATE products SET scp_status='paused' WHERE id=?", [productId]);
      paused.push(productId);
      await tellTheFounder(raw, productId);
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

/**
 * Say what happened. An account that goes read-only in silence is the version
 * of this feature that generates support tickets, and the notice is the one
 * piece of mail a paused company is still allowed to send — see
 * `account-notice.ts` for why that exemption is narrow.
 *
 * Failure here never fails the pause: the enforcement is the point, the mail is
 * the courtesy, and an email provider outage must not leave an unentitled
 * account acting.
 */
async function tellTheFounder(raw: Record<string, unknown>, productId: string): Promise<void> {
  const to = raw.email ? String(raw.email) : '';
  if (!to) return;
  try {
    const { sendAccountNotice } = await import('./account-notice.js');
    await sendAccountNotice({
      productId, to,
      notice: {
        kind: raw.tier || raw.paid_through ? 'read_only_started' : 'trial_ended',
        companyName: String(raw.name ?? 'Your company'),
        // The date the entitlement actually ran out, so re-running the sweep
        // dedups against the same notice rather than sending a new one.
        effectiveAt: (raw.paid_through ?? raw.trial_ends_at ?? null) as string | null,
      },
    });
  } catch {
    /* the pause stands regardless */
  }
}

/**
 * Apply the entitlement rule to one founder's products, right now.
 *
 * The hourly sweep is the backstop; this is what a billing event calls so the
 * effect is immediate. Both go through `entitledToAct`, which is the point:
 * the webhook records facts (tier, paid-through, trial) and then asks the ONE
 * rule what they mean. It used to decide for itself — `UPDATE products SET
 * scp_status='paused'` inline in the cancellation branch — which is how the
 * handler came to end service in the middle of a period the founder had paid
 * for. A webhook that both gathers facts and rules on them is a second
 * implementation of the rule, and it was the one that ran first.
 */
export async function applyEntitlementForFounder(
  founderId: string, now: Date = new Date(),
): Promise<EntitlementSweep> {
  const rows = await query(
    `SELECT p.id, p.name, p.scp_status, f.email, f.tier, f.trial_ends_at, f.paid_through
       FROM products p JOIN founders f ON f.id = p.owner_id
      WHERE f.id = ? AND COALESCE(p.status,'active') = 'active'`, [founderId]);
  return applyToRows(rows.rows as unknown as Array<Record<string, unknown>>, now);
}
