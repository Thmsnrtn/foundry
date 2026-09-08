// =============================================================================
// FOUNDRY — Stripe through V3.1 Tool Gateway (Wave 4, action 32)
// Second adapter migration after Resend. Per
// src/services/outbound/README.md: Resend → Stripe → GitHub. Stripe is
// lower volume than Resend but each event is higher stakes (a duplicate
// refund is much worse than a duplicate email).
//
// Handler tools registered here:
//   - stripe_update_subscription
//   - stripe_create_refund
//
// Existing callsites continue to work; new code should call gateway.invoke
// directly. Per the README, adapter migration is per-callsite, not bulk.
// =============================================================================

import { registerToolHandler, invoke, type GatewayRequest } from '../outbound/gateway.js';
import { pathSegment } from '../outbound/path-segment.js';
import { withRetry } from '../resilience.js';
import { log } from '../../lib/logger.js';

const STRIPE_TIMEOUT_MS = 10_000;
const STRIPE_API = 'https://api.stripe.com/v1';

// CLEAN-HANDS DEFAULT (liability audit 2026-07-14): Foundry does not move money
// unless a deliberate, attorney-gated decision turns it on. These handlers move
// a product's customers' money (refunds, subscription changes) and have NO live
// callers — pure latent liability. They refuse unless FOUNDRY_ENABLE_MONEY_TOOLS
// is explicitly 'true'. See docs/design/LIABILITY-AUDIT.md.
function moneyToolsEnabled(): boolean {
  return process.env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true';
}

class MoneyToolsDisabledError extends Error {
  constructor(tool: string) {
    super(`${tool} refused: Foundry does not move money by default (FOUNDRY_ENABLE_MONEY_TOOLS is off). This is the clean-hands posture — see docs/design/LIABILITY-AUDIT.md.`);
    this.name = 'MoneyToolsDisabledError';
  }
}

interface UpdateSubscriptionParams {
  subscription_id: string;
  /** Form-encoded shape Stripe API expects: e.g. { 'items[0][price]': 'price_X' } */
  body: Record<string, string>;
}

interface CreateRefundParams {
  charge_id: string;
  /** in cents; omit for full refund */
  amount?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function updateSubscriptionHandler(
  req: GatewayRequest
): Promise<{ id: string; status: string }> {
  if (!moneyToolsEnabled()) throw new MoneyToolsDisabledError('stripe_update_subscription');
  const params = req.params as unknown as UpdateSubscriptionParams;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    log.warn('stripe.update_subscription.no_key', { productId: req.productId });
    return { id: params.subscription_id, status: 'logged_only' };
  }
  const body = new URLSearchParams(params.body);

  const response = await withRetry(
    () =>
      fetch(`${STRIPE_API}/subscriptions/${pathSegment(params.subscription_id, 'subscription_id')}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Stripe-native idempotency: layer it on top of the gateway's
          // own dedup. Stripe accepts up to 255 chars; nanoid-derived dedupKey is fine.
          'Idempotency-Key': req.dedupKey ?? `gw_${Date.now()}_${Math.random()}`,
        },
        body: body.toString(),
      }),
    { timeoutMs: STRIPE_TIMEOUT_MS, maxRetries: 2 }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Stripe ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { id: string; status: string };
  log.info('stripe.update_subscription.ok', {
    productId: req.productId,
    subscriptionId: data.id,
    status: data.status,
  });
  return { id: data.id, status: data.status };
}

async function createRefundHandler(
  req: GatewayRequest
): Promise<{ id: string; status: string; amount: number }> {
  if (!moneyToolsEnabled()) throw new MoneyToolsDisabledError('stripe_create_refund');
  const params = req.params as unknown as CreateRefundParams;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    log.warn('stripe.create_refund.no_key', { productId: req.productId });
    return { id: 'log_only', status: 'logged', amount: params.amount ?? 0 };
  }

  const body = new URLSearchParams();
  body.set('charge', params.charge_id);
  if (params.amount != null) body.set('amount', String(params.amount));
  if (params.reason) body.set('reason', params.reason);

  const response = await withRetry(
    () =>
      fetch(`${STRIPE_API}/refunds`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': req.dedupKey ?? `gw_refund_${Date.now()}`,
        },
        body: body.toString(),
      }),
    { timeoutMs: STRIPE_TIMEOUT_MS, maxRetries: 2 }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Stripe refund ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { id: string; status: string; amount: number };
  log.info('stripe.create_refund.ok', {
    productId: req.productId,
    refundId: data.id,
    amount: data.amount,
  });
  return { id: data.id, status: data.status, amount: data.amount };
}

// ─── Payment links (a real experiment's offer) ───────────────────────────────
// Creates the catalog objects an experiment's offer needs on the shared
// account: product, one-time price (found by lookup key first), and a Payment
// Link tagged for the experiment on both the link and the payment intent, so
// the billing webhook can attribute every settlement. Moves no money, so it is
// not behind the clean-hands gate; it is behind the gateway because a public
// link that charges people is a `public` act (capabilities: publish_payment_link).

interface CreatePaymentLinkParams {
  product_name: string; product_metadata: Record<string, string>;
  price_lookup_key: string; unit_amount: number; currency: string; price_metadata: Record<string, string>;
  link_metadata: Record<string, string>; payment_intent_metadata: Record<string, string>; confirmation_message?: string;
}

/** A form POST to one Stripe collection, or to one object in it. Every
 * segment that reaches the URL is checked; a caller cannot hand this a path. */
async function stripeForm(apiKey: string, resource: string, body: URLSearchParams, idempotencyKey: string, id?: string): Promise<Record<string, unknown>> {
  const path = id === undefined ? `/${pathSegment(resource, 'stripe_resource')}` : `/${pathSegment(resource, 'stripe_resource')}/${pathSegment(id, 'stripe_id')}`;
  const init = {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey },
    body: body.toString(),
  };
  const response = await withRetry(
    () => id === undefined
      ? fetch(`${STRIPE_API}/${pathSegment(resource, 'stripe_resource')}`, init)
      : fetch(`${STRIPE_API}/${pathSegment(resource, 'stripe_resource')}/${pathSegment(id, 'stripe_id')}`, init),
    { timeoutMs: STRIPE_TIMEOUT_MS, maxRetries: 2 },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Stripe ${path} ${response.status}: ${text.slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

async function createPaymentLinkHandler(req: GatewayRequest): Promise<{ id: string; url: string; price_id: string }> {
  const params = req.params as unknown as CreatePaymentLinkParams;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!Number.isInteger(params.unit_amount) || params.unit_amount <= 0) throw new Error('unit_amount must be a positive integer');
  if (params.link_metadata?.app !== 'foundry' || params.payment_intent_metadata?.app !== 'foundry') throw new Error('payment links must be tagged app=foundry');
  const key = req.dedupKey ?? `gw_plink_${Date.now()}`;

  const found = await withRetry(
    () => fetch(`${STRIPE_API}/prices?active=true&limit=1&lookup_keys[]=${pathSegment(params.price_lookup_key, 'price_lookup_key')}`, { headers: { Authorization: `Bearer ${apiKey}` } }),
    { timeoutMs: STRIPE_TIMEOUT_MS, maxRetries: 2 },
  );
  if (!found.ok) throw new Error(`Stripe prices ${found.status}`);
  let priceId = ((await found.json()) as { data: Array<{ id: string }> }).data[0]?.id;
  if (!priceId) {
    const product = new URLSearchParams({ name: params.product_name });
    for (const [k, v] of Object.entries(params.product_metadata ?? {})) product.set(`metadata[${k}]`, v);
    const created = await stripeForm(apiKey, 'products', product, `${key}:product`);
    const price = new URLSearchParams({ product: String(created.id), unit_amount: String(params.unit_amount), currency: params.currency, lookup_key: params.price_lookup_key });
    for (const [k, v] of Object.entries(params.price_metadata ?? {})) price.set(`metadata[${k}]`, v);
    priceId = String((await stripeForm(apiKey, 'prices', price, `${key}:price`)).id);
  }

  const link = new URLSearchParams({ 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1' });
  for (const [k, v] of Object.entries(params.link_metadata)) link.set(`metadata[${k}]`, v);
  for (const [k, v] of Object.entries(params.payment_intent_metadata)) link.set(`payment_intent_data[metadata][${k}]`, v);
  if (params.confirmation_message) {
    link.set('after_completion[type]', 'hosted_confirmation');
    link.set('after_completion[hosted_confirmation][custom_message]', params.confirmation_message.slice(0, 500));
  }
  const data = await stripeForm(apiKey, 'payment_links', link, `${key}:link`);
  log.info('stripe.create_payment_link.ok', { productId: req.productId, paymentLinkId: String(data.id) });
  return { id: String(data.id), url: String(data.url), price_id: priceId };
}

/**
 * THE OFFER COMES DOWN WHEN THE TEST ENDS. A Payment Link cannot be deleted,
 * only deactivated; a deactivated link answers every visitor that it is no
 * longer available, so a purchase cannot arrive at a test that has settled or
 * been stopped. Idempotent: deactivating twice is one state.
 */
async function deactivatePaymentLinkHandler(req: GatewayRequest): Promise<{ id: string; active: boolean }> {
  const params = req.params as unknown as { payment_link_id: string };
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    log.warn('stripe.deactivate_payment_link.no_key', { productId: req.productId });
    return { id: params.payment_link_id, active: false };
  }
  const data = await stripeForm(apiKey, 'payment_links', new URLSearchParams({ active: 'false' }), `${req.dedupKey ?? `gw_plink_off_${Date.now()}`}:off`, params.payment_link_id);
  log.info('stripe.deactivate_payment_link.ok', { productId: req.productId, paymentLinkId: String(data.id) });
  return { id: String(data.id), active: Boolean(data.active) };
}

// Side-effect at module load — register the handlers.
const STRIPE_POLICY = {
  actor: 'billing_control', surface: 'billing', dataClass: 'customer',
  requireDedupKey: true, requireCustomerExternalId: true,
} as const;
registerToolHandler('stripe_update_subscription', updateSubscriptionHandler, STRIPE_POLICY);
registerToolHandler('stripe_create_refund', createRefundHandler, STRIPE_POLICY);
registerToolHandler('stripe_create_payment_link', createPaymentLinkHandler, STRIPE_POLICY);
registerToolHandler('stripe_deactivate_payment_link', deactivatePaymentLinkHandler, STRIPE_POLICY);

// ─── Exposed for tests + external re-registration ────────────────────────────
export { updateSubscriptionHandler, createRefundHandler, createPaymentLinkHandler, deactivatePaymentLinkHandler };

// ─── Convenience callers ──────────────────────────────────────────────────────

export async function gatewayUpdateSubscription(opts: {
  productId: string;
  subscriptionId: string;
  body: Record<string, string>;
  dedupKey: string;          // required for refund/subscription paths
  customerExternalId: string; // Stripe customer id; bounds budget
}): Promise<ReturnType<typeof invoke>> {
  return invoke({
    productId: opts.productId,
    tool: 'stripe_update_subscription',
    action: `update Stripe subscription ${opts.subscriptionId}`,
    params: { subscription_id: opts.subscriptionId, body: opts.body },
    dedupKey: opts.dedupKey,
    customerExternalId: opts.customerExternalId,
    surface: 'billing',
    dataClass: 'customer',
  });
}

export async function gatewayCreateRefund(opts: {
  productId: string;
  chargeId: string;
  amount?: number;
  reason?: CreateRefundParams['reason'];
  dedupKey: string;
  customerExternalId: string;
}): Promise<ReturnType<typeof invoke>> {
  return invoke({
    productId: opts.productId,
    tool: 'stripe_create_refund',
    action: `Stripe refund on charge ${opts.chargeId}`,
    params: { charge_id: opts.chargeId, amount: opts.amount, reason: opts.reason },
    dedupKey: opts.dedupKey,
    customerExternalId: opts.customerExternalId,
    surface: 'billing',
    dataClass: 'customer',
  });
}
