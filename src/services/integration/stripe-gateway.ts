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

// Side-effect at module load — register both handlers.
const STRIPE_POLICY = {
  actor: 'billing_control', surface: 'billing', dataClass: 'customer',
  requireDedupKey: true, requireCustomerExternalId: true,
} as const;
registerToolHandler('stripe_update_subscription', updateSubscriptionHandler, STRIPE_POLICY);
registerToolHandler('stripe_create_refund', createRefundHandler, STRIPE_POLICY);

// ─── Exposed for tests + external re-registration ────────────────────────────
export { updateSubscriptionHandler, createRefundHandler };

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
