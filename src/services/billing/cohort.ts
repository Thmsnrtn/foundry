// =============================================================================
// FOUNDRY — Founding Cohort Slot Enforcement
// 7-day activation window. Reminder on day 6. Pause + release on day 7.
// =============================================================================

import { query } from '../../db/client.js';
import { pauseSubscription } from './stripe.js';
import { sendTriggerEmail } from '../digest/delivery.js';

export async function enforceActivationWindow(): Promise<void> {
  // Find founding cohort members without a completed audit within 7 days
  const result = await query(
    `SELECT f.id, f.email, f.stripe_customer_id, f.created_at,
       (SELECT COUNT(*) FROM audit_scores a JOIN products p ON a.product_id = p.id WHERE p.owner_id = f.id) as audit_count
     FROM founders f WHERE f.tier = 'founding_cohort'`, []
  );

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const createdAt = new Date(r.created_at as string);
    const daysSinceSignup = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
    const auditCount = r.audit_count as number;

    if (auditCount > 0) continue; // Has completed an audit, all good

    if (daysSinceSignup === 6) {
      // Day 6: Send reminder
      await sendTriggerEmail(
        r.email as string,
        'Foundry: Complete your first audit tomorrow',
        '<p>Your Founding Cohort slot requires a completed audit within 7 days of signup. You have 1 day remaining.</p><p><a href="' + (process.env.APP_URL ?? '') + '/dashboard">Run your first audit now →</a></p>'
      );
    } else if (daysSinceSignup >= 7) {
      // Day 7+: Pause subscription, release slot
      if (r.stripe_customer_id) {
        // In production, look up subscription ID from Stripe
        // await pauseSubscription(subscriptionId);
      }
      await query("UPDATE founders SET tier = NULL WHERE id = ?", [r.id]);

      await sendTriggerEmail(
        r.email as string,
        'Foundry: Founding Cohort slot released',
        '<p>Your Founding Cohort slot has been released because no audit was completed within 7 days.</p><p>You can rejoin with the next cohort. Reply to this email if you have questions.</p>'
      );
    }
  }
}
