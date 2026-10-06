// =============================================================================
// FOUNDRY — the Stripe events that report an experiment's sale
//
// MOVED HERE FROM `services/billing/stripe.ts` (Private S7b1, 29 September
// 2026). That file was two things: Foundry's own subscription billing — tiers,
// trials, checkout, dunning — and the door through which the world reports a
// sale to one of the owner's experiments. The first served customers of
// Foundry, and Foundry has none: it is the owner's alone. The second is how
// Experiment 001's and the Workshop's money arrives. So the second moved here,
// unchanged, and the first was deleted.
//
// WHAT IT DOES, in order, all of it inherited:
//   1. verifies the signature against STRIPE_WEBHOOK_SECRET;
//   2. claims the event id atomically, so a replay or a concurrent redelivery
//      finds the claim and stops;
//   3. records the sale for the experiment it is tagged for, then reads the
//      same event as money — sale first, because the ledger's charge row
//      points at the outcome the sale intake creates;
//   4. RELEASES THE CLAIM if anything throws, so Stripe is answered 400 and
//      retries, instead of being told 200 about a sale nothing recorded.
//
// An event that is not an experiment's — a subscription on another app's
// price, say — is recorded by neither intake and changes nothing.
// =============================================================================

import { stripeClient } from '../economy/provider-stripe.js';
import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

export async function handleWebhook(payload: string, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET required');

  const event = stripeClient().webhooks.constructEvent(payload, signature, secret);

  // RT08-P0-03: one claim per event id, taken atomically.
  const claim = await query(
    'INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, processed_at, livemode) VALUES (?, ?, CURRENT_TIMESTAMP, ?)',
    [event.id, event.type, event.livemode === undefined ? null : (event.livemode ? 1 : 0)]);
  if ((claim.rowsAffected ?? 0) === 0) return; // Already processed, or being processed
  try {
    const asPayload = event as unknown as { id?: string; type: string; created?: number; data?: { object?: unknown } };
    const { intakeStripeSettlement } = await import('./settlement-intake.js');
    const taken = await intakeStripeSettlement(asPayload);
    // TAGGED OURS AND MATCHED NOTHING (remediation 1.6): acknowledged, and the
    // reason kept on the claim, where Controls reads it.
    if (taken.recorded.length === 0 && taken.refused.length > 0) {
      await query(`UPDATE stripe_webhook_events SET unmatched_because = ? WHERE event_id = ?`,
        [taken.refused.map((r) => `${r.providerRef}: ${r.reason}`).join('; ').slice(0, 1000), event.id]);
    }
    const { intakeStripeEconomics } = await import('../economy/stripe-economics.js');
    await intakeStripeEconomics(asPayload);
  } catch (err) {
    await query('DELETE FROM stripe_webhook_events WHERE event_id = ?', [event.id]).catch(() => undefined);
    log.warn('stripe webhook not processed; claim released for the provider to retry',
      { eventId: event.id, eventType: event.type, error: String(err) });
    throw err;
  }
}
