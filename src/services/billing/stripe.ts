// =============================================================================
// FOUNDRY — Stripe Billing Integration
// Three tiers: Solo ($79), Growth ($199), Investor-Ready ($399)
// =============================================================================

import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { createNotification } from '../ux/notifications.js';
import { withRetry } from '../resilience.js';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY required');
    _stripe = new Stripe(key, { apiVersion: '2023-10-16' });
  }
  return _stripe;
}

// ─── Money idempotency (Roadmap 3.4) ──────────────────────────────────────────
// Every mutating Stripe call is wrapped in withRetry(). Without an idempotency
// key, a retry that fires after the ORIGINAL request already succeeded (but
// whose response was lost to a timeout/network blip) creates a DUPLICATE
// customer/subscription — i.e. a double-charge. Stripe dedups server-side (24h)
// on a per-request `idempotencyKey`. We mint ONE key per logical operation and
// reuse it across that call's retries: retries dedup, but a genuinely new
// operation (e.g. re-subscribing after a cancel) gets a fresh key and is not
// blocked. Read-only calls need no key.
function idemKey(): string {
  return `foundry_${nanoid(24)}`;
}

export async function createCustomer(email: string, name: string | null): Promise<string> {
  const stripe = getStripe();
  const key = idemKey();
  const customer = await withRetry(() =>
    stripe.customers.create({ email, name: name ?? undefined }, { idempotencyKey: key }),
  );
  return customer.id;
}

export async function createSubscription(customerId: string, tier: 'solo' | 'growth' | 'investor_ready'): Promise<string> {
  const stripe = getStripe();
  const priceId = getPriceId(tier);
  const key = idemKey();
  const subscription = await withRetry(() => stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  }, { idempotencyKey: key }));
  return subscription.id;
}

/** Default trial length for new subscriptions (Phase 1.3). Env-overridable. */
export const TRIAL_PERIOD_DAYS = parseInt(process.env.TRIAL_PERIOD_DAYS ?? '14', 10);

export async function createCheckoutSession(
  customerId: string,
  tier: 'solo' | 'growth' | 'investor_ready',
  successUrl: string,
  cancelUrl: string,
  trialDays: number = TRIAL_PERIOD_DAYS,
): Promise<string> {
  const stripe = getStripe();
  const key = idemKey();
  const session = await withRetry(() => stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: getPriceId(tier), quantity: 1 }],
    // Card-upfront 14-day trial: collect payment method now, charge after trial.
    subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, { idempotencyKey: key }));
  return session.url ?? '';
}

export async function pauseSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  const key = idemKey();
  await withRetry(() => stripe.subscriptions.update(
    subscriptionId,
    { pause_collection: { behavior: 'void' } },
    { idempotencyKey: key },
  ));
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  const key = idemKey();
  await withRetry(() => stripe.subscriptions.cancel(subscriptionId, undefined, { idempotencyKey: key }));
}

export async function getSoloSlotCount(): Promise<number> {
  const result = await query("SELECT COUNT(*) as c FROM founders WHERE tier = 'solo'", []);
  return (result.rows[0] as Record<string, number>)?.c ?? 0;
}

export async function handleWebhook(payload: string, signature: string): Promise<void> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET required');

  const event = stripe.webhooks.constructEvent(payload, signature, secret);

  // RT08-P0-03: Idempotency — skip already-processed events to prevent replay attacks
  const existing = await query('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?', [event.id]);
  if (existing.rows.length > 0) return; // Already processed
  await query('INSERT INTO stripe_webhook_events (event_id, event_type, processed_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [event.id, event.type]);

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      // Update founder tier based on price
      const priceId = sub.items.data[0]?.price.id;
      const tier = getTierFromPrice(priceId ?? '');
      if (tier) {
        // Persist the trial window: sub.trial_end is set while status is
        // 'trialing' and cleared once the trial converts to 'active'. This
        // drives the trial-days-remaining badge and expiry gating (Phase 1.3).
        const trialEndsAt =
          sub.status === 'trialing' && sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null;
        await query(
          'UPDATE founders SET tier = ?, trial_ends_at = ? WHERE stripe_customer_id = ?',
          [tier, trialEndsAt, sub.customer],
        );

        // Activation funnel: trial_started (trialing) / paid (active) — Phase 5.2.
        void (async () => {
          try {
            const fr = await query('SELECT id FROM founders WHERE stripe_customer_id = ?', [sub.customer]);
            const fid = (fr.rows[0] as Record<string, string> | undefined)?.id;
            if (fid) {
              const { recordFunnelStep } = await import('../telemetry/funnel.js');
              if (sub.status === 'trialing') await recordFunnelStep('trial_started', { founderId: fid });
              if (sub.status === 'active') await recordFunnelStep('paid', { founderId: fid });
            }
          } catch { /* non-fatal */ }
        })();

        // Wave 3 — referral attribution. On subscription.created (only),
        // fire the 'paid' conversion event for whoever invited this
        // founder. Idempotent dedup is in the referrals service, but as
        // an extra guard we only fire on 'created'.
        if (event.type === 'customer.subscription.created') {
          try {
            const founderRow = await query(
              'SELECT id, referred_by_code FROM founders WHERE stripe_customer_id = ?',
              [sub.customer]
            );
            const f = founderRow.rows[0] as Record<string, string | null> | undefined;
            if (f?.referred_by_code) {
              const { recordReferralEvent } = await import(
                '../distribution/referrals.js'
              );
              await recordReferralEvent(f.referred_by_code, 'paid', {
                invited_founder_id: f.id ?? undefined,
                metadata: { tier, subscription_id: sub.id },
              });
            }
          } catch {
            /* attribution failure must not break the webhook handler */
          }
        }
      } else {
        console.warn(`[STRIPE WEBHOOK] Unrecognised price ID: ${priceId} (customer: ${sub.customer}). Check STRIPE_*_PRICE_ID env vars.`);
      }
      // DEFECT-0053: Dunning — notify founder when subscription goes past_due
      if (sub.status === 'past_due') {
        const pastDueCustomerId = sub.customer as string;
        const pastDueFounder = await query(
          'SELECT id FROM founders WHERE stripe_customer_id = ?',
          [pastDueCustomerId],
        );
        if (pastDueFounder.rows.length > 0) {
          const founder = pastDueFounder.rows[0] as Record<string, string>;
          await createNotification(
            founder.id,
            null,
            'system',
            'Subscription Past Due',
            'Your subscription is past due. Please update your payment method to continue using all features.',
            '/settings/billing',
            'Update Payment Method',
          );
        }
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await query('UPDATE founders SET tier = NULL, trial_ends_at = NULL WHERE stripe_customer_id = ?', [sub.customer]);
      // EDGE-02 + RT08-P0: Pause SCP at BOTH levels to stop AI credit burn
      // The scheduler checks products.scp_status, not agent_instances.status
      const cancelledFounder = await query('SELECT id FROM founders WHERE stripe_customer_id = ?', [sub.customer]);
      if (cancelledFounder.rows.length > 0) {
        const founderId = (cancelledFounder.rows[0] as Record<string, string>).id;
        // Pause at product level (scheduler checks this)
        await query(
          `UPDATE products SET scp_status = 'paused' WHERE owner_id = ?`,
          [founderId]
        );
        // Also pause individual instances
        await query(
          `UPDATE agent_instances SET status = 'paused', updated_at = datetime('now')
           WHERE product_id IN (SELECT id FROM products WHERE owner_id = ?)`,
          [founderId]
        );
      }
      break;
    }

    // DEFECT-0053: Dunning — handle failed payments
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const founderResult = await query(
        'SELECT id FROM founders WHERE stripe_customer_id = ?',
        [customerId],
      );
      if (founderResult.rows.length > 0) {
        const founder = founderResult.rows[0] as Record<string, string>;
        await createNotification(
          founder.id,
          null,
          'system',
          'Payment Failed',
          'Your last payment failed. Please update your payment method in Settings to avoid service interruption.',
          '/settings/billing',
          'Update Payment Method',
        );
      }
      break;
    }

  }
}

function getPriceId(tier: string): string {
  let priceId: string | undefined;
  switch (tier) {
    case 'solo': priceId = process.env.STRIPE_SOLO_PRICE_ID; break;
    case 'growth': priceId = process.env.STRIPE_GROWTH_PRICE_ID; break;
    case 'investor_ready': priceId = process.env.STRIPE_INVESTOR_READY_PRICE_ID; break;
    default: throw new Error(`Unknown tier: ${tier}`);
  }
  if (!priceId) throw new Error(`STRIPE_${tier.toUpperCase()}_PRICE_ID is not set`);
  return priceId;
}

function getTierFromPrice(priceId: string): string | null {
  if (priceId === process.env.STRIPE_SOLO_PRICE_ID) return 'solo';
  if (priceId === process.env.STRIPE_GROWTH_PRICE_ID) return 'growth';
  if (priceId === process.env.STRIPE_INVESTOR_READY_PRICE_ID) return 'investor_ready';
  return null;
}
