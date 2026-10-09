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
import { priceIsMostlyFees } from '../venture/fee-floor.js';
import { query } from '../../db/client.js';

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
  /** The charge to refund. Or, for a checkout whose charge was never named, the intent (pi_ only). */
  charge_id?: string;
  payment_intent?: string;
  /** A week of a subscription: the invoice it was, whose subscription must be Foundry's and whose payment must be this charge. */
  invoice_id?: string;
  /** in cents */
  amount?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

// ─── The money is Foundry's to return, or it is not touched ──────────────────
//
// THE ACCOUNT IS SHARED (docs/stripe-shared-account.md): the owner's land sales
// and another app's subscriptions live beside Foundry's tests, and a restricted
// key limits by resource, never by whose sale it was. So the handler reads the
// money it is asked to move from the provider itself, and refuses unless it is
// a sale Foundry tagged — a caller passing a charge id is not evidence that
// the charge is Foundry's to refund (R21).
async function stripeRead<T>(apiKey: string, path: string): Promise<T> {
  // Every caller builds `path` from pathSegment-checked ids; it is joined here
  // rather than interpolated so the URL check reads the callers, not this.
  const response = await withRetry(() => fetch(STRIPE_API + path, { headers: { Authorization: `Bearer ${apiKey}` } }),
    { timeoutMs: STRIPE_TIMEOUT_MS, maxRetries: 2 });
  if (!response.ok) throw new Error(`Stripe ${path.split('?')[0]} ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return (await response.json()) as T;
}
const isFoundrys = (meta: Record<string, string> | null | undefined): boolean => meta?.app === 'foundry' && typeof meta.experiment_id === 'string' && meta.experiment_id.trim() !== '';

/** The subscription an invoice belongs to, and its tag, in either of the provider's shapes. */
async function invoiceSubscriptionTag(apiKey: string, invoiceId: string): Promise<{ tag: Record<string, string> | null; chargeId: string | null }> {
  const inv = await stripeRead<{ charge?: string | { id?: string } | null; payment_intent?: string | null; subscription?: string | null;
    subscription_details?: { metadata?: Record<string, string> | null } | null;
    parent?: { subscription_details?: { subscription?: string | null; metadata?: Record<string, string> | null } | null } | null;
    payments?: { data?: Array<{ payment?: { charge?: string | null; payment_intent?: string | null } }> } }>(
    apiKey, `/invoices/${pathSegment(invoiceId, 'invoice_id')}?expand[]=payments`);
  let tag = inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata ?? null;
  const sub = inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null;
  if (!isFoundrys(tag) && sub) tag = (await stripeRead<{ metadata?: Record<string, string> | null }>(apiKey, `/subscriptions/${pathSegment(sub, 'subscription_id')}`)).metadata ?? null;
  let chargeId: string | null = typeof inv.charge === 'string' ? inv.charge : inv.charge && typeof inv.charge === 'object' ? inv.charge.id ?? null : null;
  if (!chargeId) {
    const paid = inv.payments?.data?.find((x) => x.payment?.charge || x.payment?.payment_intent)?.payment;
    chargeId = paid?.charge ?? null;
    const intent = chargeId ? null : paid?.payment_intent ?? inv.payment_intent ?? null;
    if (intent) chargeId = (await stripeRead<{ latest_charge?: string | null }>(apiKey, `/payment_intents/${pathSegment(intent, 'payment_intent_id')}`)).latest_charge ?? null;
  }
  return { tag, chargeId };
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
  // ONE CHANGE, ON FOUNDRY'S OWN SUBSCRIPTIONS ONLY. Ending at the paid period
  // is the only edit Foundry makes to what anybody is charged; any other body,
  // or a subscription another business on this account started, is refused
  // here whatever approved it (R21).
  const keys = Object.keys(params.body ?? {});
  if (keys.length !== 1 || params.body.cancel_at_period_end !== 'true') throw new Error('subscription change refused: the only change Foundry makes is ending at the paid period');
  const current = await stripeRead<{ metadata?: Record<string, string> | null }>(apiKey, `/subscriptions/${pathSegment(params.subscription_id, 'subscription_id')}`);
  if (!isFoundrys(current.metadata)) throw new Error('subscription change refused: the subscription is not one Foundry started');
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

  // WHICH MONEY, READ FROM THE PROVIDER. A charge named, or an intent's latest
  // charge (pi_ only: an invoice is never refunded by its intent).
  let chargeId = params.charge_id ?? null;
  if (!chargeId && params.payment_intent) {
    if (!/^pi_[A-Za-z0-9]+$/.test(params.payment_intent)) throw new Error('refund refused: only a payment intent (pi_) may stand for a charge');
    chargeId = (await stripeRead<{ latest_charge?: string | null }>(apiKey, `/payment_intents/${pathSegment(params.payment_intent, 'payment_intent_id')}`)).latest_charge ?? null;
  }
  if (!chargeId) throw new Error('refund refused: no charge was named');
  const charge = await stripeRead<{ id: string; amount: number; amount_refunded?: number; metadata?: Record<string, string> | null }>(
    apiKey, `/charges/${pathSegment(chargeId, 'charge_id')}`);
  if (params.invoice_id) {
    // A WEEK OF A SUBSCRIPTION: the subscription must be Foundry's, and the
    // invoice's payment must be exactly this charge.
    const week = await invoiceSubscriptionTag(apiKey, params.invoice_id);
    if (!isFoundrys(week.tag)) throw new Error('refund refused: the invoice belongs to a subscription Foundry did not start');
    if (week.chargeId !== charge.id) throw new Error('refund refused: the charge is not the payment of that invoice');
  } else if (!isFoundrys(charge.metadata)) {
    throw new Error('refund refused: the charge is not a sale Foundry tagged; another business on this account owns it');
  }
  const left = charge.amount - (charge.amount_refunded ?? 0);
  const amount = params.amount ?? left;
  if (!Number.isInteger(amount) || amount <= 0 || amount > left) throw new Error(`refund refused: ${String(amount)} cents asked, ${String(left)} left to refund on that charge`);

  const body = new URLSearchParams();
  body.set('charge', charge.id);
  body.set('amount', String(amount));
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
  /** A price the buyer chooses: floor, ceiling and suggestion, in cents. `unit_amount` is then the suggestion. */
  custom_amount?: { minimum: number; maximum: number; preset: number };
  /** A price charged every interval until cancelled. Its tag rides on the subscription, not an intent. */
  recurring?: { interval: 'week' };
  subscription_metadata?: Record<string, string>;
  link_metadata: Record<string, string>; payment_intent_metadata?: Record<string, string>; confirmation_message?: string;
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
  // THE TAG LIVES WHERE THE MONEY WILL: on the intent of a one-time payment,
  // on the subscription of a recurring one. Exactly one of them, never both.
  const tagged = params.recurring ? params.subscription_metadata : params.payment_intent_metadata;
  if (params.link_metadata?.app !== 'foundry' || tagged?.app !== 'foundry') throw new Error('payment links must be tagged app=foundry');
  if (params.recurring && (params.payment_intent_metadata || params.custom_amount || params.recurring.interval !== 'week')) {
    throw new Error('a subscription is charged weekly at its stated price, and its tag rides on the subscription');
  }
  const c = params.custom_amount;
  if (c && !(Number.isInteger(c.minimum) && Number.isInteger(c.maximum) && Number.isInteger(c.preset)
    && c.minimum >= 50 && c.minimum <= c.preset && c.preset <= c.maximum && c.preset === params.unit_amount)) {
    throw new Error('a chosen amount needs a whole-cent floor of at least 50, a suggestion between floor and ceiling, and the suggestion as unit_amount');
  }
  // NO PRICE IS MOSTLY FEES (R29), refused at the door as well as before it:
  // a link is never minted for an amount the card fee takes a fifth of.
  const mostlyFees = priceIsMostlyFees({ venue: 'stripe', amountCents: params.unit_amount, chosen: c ? { minimumCents: c.minimum } : null });
  if (mostlyFees) throw new Error(`refused: ${mostlyFees}`);
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
    const price = c
      ? new URLSearchParams({ product: String(created.id), currency: params.currency, lookup_key: params.price_lookup_key,
        'custom_unit_amount[enabled]': 'true', 'custom_unit_amount[minimum]': String(c.minimum),
        'custom_unit_amount[maximum]': String(c.maximum), 'custom_unit_amount[preset]': String(c.preset) })
      : new URLSearchParams({ product: String(created.id), unit_amount: String(params.unit_amount), currency: params.currency, lookup_key: params.price_lookup_key,
        ...(params.recurring ? { 'recurring[interval]': params.recurring.interval } : {}) });
    for (const [k, v] of Object.entries(params.price_metadata ?? {})) price.set(`metadata[${k}]`, v);
    priceId = String((await stripeForm(apiKey, 'prices', price, `${key}:price`)).id);
  }

  const link = new URLSearchParams({ 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1' });
  for (const [k, v] of Object.entries(params.link_metadata)) link.set(`metadata[${k}]`, v);
  if (params.recurring) for (const [k, v] of Object.entries(params.subscription_metadata ?? {})) link.set(`subscription_data[metadata][${k}]`, v);
  else for (const [k, v] of Object.entries(params.payment_intent_metadata ?? {})) link.set(`payment_intent_data[metadata][${k}]`, v);
  if (params.confirmation_message) {
    link.set('after_completion[type]', 'hosted_confirmation');
    link.set('after_completion[hosted_confirmation][custom_message]', params.confirmation_message.slice(0, 500));
  }
  // STRIPE TAX, ON HIS WORD ONLY (F2, PENDING 35): his own signed `stripe_tax`
  // row turns on automatic tax; with none the link carries no tax line. Stripe
  // Tax must be activated on the account for this to succeed, which is his act.
  const owner = (await query('SELECT owner_id FROM products WHERE id = ?', [req.productId])).rows[0] as Record<string, unknown> | undefined;
  if (owner?.owner_id) {
    const { stripeTaxOn } = await import('../venture/storefront/tax.js');
    if (await stripeTaxOn(String(owner.owner_id))) link.set('automatic_tax[enabled]', 'true');
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

// ─── No convenience callers ─────────────────────────────────────────────────
// gatewayCreateRefund and gatewayUpdateSubscription took the money's identity
// from their caller and had no caller in src. Deleted with R21: a refund or a
// stop is asked for by the hand, from a fulfilment row, and nowhere else.
