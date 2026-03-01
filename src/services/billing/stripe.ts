// =============================================================================
// FOUNDRY — Stripe Billing Integration
// Three tiers: Founding Cohort ($99), Growth ($199), Scale ($399)
// =============================================================================

import Stripe from 'stripe';
import { query } from '../../db/client.js';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY required');
    _stripe = new Stripe(key, { apiVersion: '2023-10-16' });
  }
  return _stripe;
}

export async function createCustomer(email: string, name: string | null): Promise<string> {
  const stripe = getStripe();
  const customer = await stripe.customers.create({ email, name: name ?? undefined });
  return customer.id;
}

export async function createSubscription(customerId: string, tier: 'founding_cohort' | 'growth' | 'scale'): Promise<string> {
  const stripe = getStripe();
  const priceId = getPriceId(tier);
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });
  return subscription.id;
}

export async function createCheckoutSession(customerId: string, tier: 'founding_cohort' | 'growth' | 'scale', successUrl: string, cancelUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: getPriceId(tier), quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url ?? '';
}

export async function pauseSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, { pause_collection: { behavior: 'void' } });
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.cancel(subscriptionId);
}

export async function getFoundingCohortSlotCount(): Promise<number> {
  const result = await query("SELECT COUNT(*) as c FROM founders WHERE tier = 'founding_cohort'", []);
  return (result.rows[0] as Record<string, number>)?.c ?? 0;
}

export async function handleWebhook(payload: string, signature: string): Promise<void> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET required');

  const event = stripe.webhooks.constructEvent(payload, signature, secret);

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      // Update founder tier based on price
      const priceId = sub.items.data[0]?.price.id;
      const tier = getTierFromPrice(priceId ?? '');
      if (tier) {
        await query('UPDATE founders SET tier = ? WHERE stripe_customer_id = ?', [tier, sub.customer]);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await query('UPDATE founders SET tier = NULL WHERE stripe_customer_id = ?', [sub.customer]);
      break;
    }
  }
}

function getPriceId(tier: string): string {
  switch (tier) {
    case 'founding_cohort': return process.env.STRIPE_FOUNDING_COHORT_PRICE_ID ?? '';
    case 'growth': return process.env.STRIPE_GROWTH_PRICE_ID ?? '';
    case 'scale': return process.env.STRIPE_SCALE_PRICE_ID ?? '';
    default: throw new Error(`Unknown tier: ${tier}`);
  }
}

function getTierFromPrice(priceId: string): string | null {
  if (priceId === process.env.STRIPE_FOUNDING_COHORT_PRICE_ID) return 'founding_cohort';
  if (priceId === process.env.STRIPE_GROWTH_PRICE_ID) return 'growth';
  if (priceId === process.env.STRIPE_SCALE_PRICE_ID) return 'scale';
  return null;
}
