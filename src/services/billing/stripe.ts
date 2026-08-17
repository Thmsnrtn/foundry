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

// ─── Shared-account namespace (see docs/stripe-shared-account.md) ──────────────
// This account is shared with AcreOS and the personal land sales. Every object we
// create carries `app: 'foundry'`, and we only ever act on objects tagged for us.
const APP = 'foundry' as const;

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

export async function createCustomer(email: string, name: string | null, founderId?: string): Promise<string> {
  const stripe = getStripe();
  const key = idemKey();
  const customer = await withRetry(() =>
    stripe.customers.create({
      email,
      name: name ?? undefined,
      // Namespace every customer to Foundry (+ our own id when known) so the
      // shared account can be filtered to just our objects.
      metadata: founderId ? { app: APP, founder_id: founderId } : { app: APP },
    }, { idempotencyKey: key }),
  );
  return customer.id;
}

export async function createSubscription(customerId: string, tier: 'solo' | 'growth' | 'investor_ready'): Promise<string> {
  const stripe = getStripe();
  const priceId = await getPriceId(tier);
  const key = idemKey();
  const subscription = await withRetry(() => stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
    metadata: { app: APP, plan_key: tier },
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
  const priceId = await getPriceId(tier);
  const key = idemKey();
  const session = await withRetry(() => stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    // Card-upfront 14-day trial: collect payment method now, charge after trial.
    // Tag the resulting subscription so shared-account webhooks can claim it.
    subscription_data: {
      metadata: { app: APP, plan_key: tier },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    metadata: { app: APP, plan_key: tier },
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, { idempotencyKey: key }));
  return session.url ?? '';
}

/** Create an owner-requested Stripe portal session through the billing
 * authenticator that owns the shared-account credential and namespace. */
export async function createBillingPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const key = idemKey();
  const session = await withRetry(() => stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  }, { idempotencyKey: key }));
  return session.url;
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

/**
 * Cancel at the end of the current period — the ordinary convention, and what
 * the founder is owed. `subscriptions.cancel()` ends it immediately and issues
 * no refund for the remainder, so a founder who cancelled on day 2 of a month
 * they had paid for lost twenty-eight days of service they had bought.
 *
 * Stripe then sends `customer.subscription.deleted` when the period actually
 * ends, which is where entitlement is re-evaluated.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  const key = idemKey();
  await withRetry(() => stripe.subscriptions.update(
    subscriptionId,
    { cancel_at_period_end: true },
    { idempotencyKey: key },
  ));
}

/**
 * Send one account notice per company a founder owns.
 *
 * Account mail is addressed to a person, but the gateway governs effects per
 * COMPANY — that is where the kill-switch, the pause and the audit row live. So
 * a notice about the account goes out once per company, through the same door,
 * rather than around it. Failures are swallowed: a billing webhook that throws
 * gets retried by Stripe, and re-running it for the sake of an email would
 * re-run everything else with it.
 */
async function notifyOwnedCompanies(
  founderId: string,
  notice: { kind: 'payment_failed' | 'subscription_cancelled'; effectiveAt: string | null },
): Promise<void> {
  try {
    const { sendAccountNotice } = await import('./account-notice.js');
    const rows = await query(
      `SELECT p.id, p.name, f.email FROM products p JOIN founders f ON f.id = p.owner_id
        WHERE f.id = ? AND COALESCE(p.status,'active') = 'active'`, [founderId]);
    for (const raw of rows.rows as unknown as Array<Record<string, unknown>>) {
      await sendAccountNotice({
        productId: String(raw.id),
        to: String(raw.email ?? ''),
        notice: {
          kind: notice.kind,
          companyName: String(raw.name ?? 'Your company'),
          effectiveAt: notice.effectiveAt,
        },
      });
    }
  } catch {
    /* the billing fact is recorded either way */
  }
}

/** Stripe's `current_period_end`, as an ISO string, or null when the payload
 * does not carry one. Typed loosely on purpose: the field moved to the
 * subscription item in newer API versions, and reading it defensively is
 * cheaper than being wrong about which shape arrived. */
function periodEndIso(sub: Stripe.Subscription): string | null {
  const raw = (sub as unknown as Record<string, unknown>).current_period_end
    ?? (sub.items?.data?.[0] as unknown as Record<string, unknown> | undefined)?.current_period_end;
  const seconds = typeof raw === 'number' ? raw : Number.NaN;
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
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
      // Shared-account guard: this endpoint receives events for AcreOS and the
      // land sales too. If the price is tagged for another app, it isn't ours.
      const priceObj = sub.items.data[0]?.price;
      const priceApp = (priceObj?.metadata as Record<string, string> | undefined)?.app;
      if (priceApp && priceApp !== APP) break;
      // Update founder tier based on price
      const priceId = priceObj?.id;
      const tier = getTierFromPrice(priceId ?? '', priceObj);
      if (tier) {
        // Persist the trial window: sub.trial_end is set while status is
        // 'trialing' and cleared once the trial converts to 'active'. This
        // drives the trial-days-remaining badge and expiry gating (Phase 1.3).
        const trialEndsAt =
          sub.status === 'trialing' && sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null;
        // The period the founder has paid for. Recorded on every subscription
        // event, including the one that flags a cancellation at period end,
        // because that is the date the service is owed until. Stripe advances
        // it when it issues the next invoice, so a past-due account keeps its
        // access through the dunning retries rather than being cut off on the
        // first failed charge.
        const paidThrough = periodEndIso(sub);
        await query(
          `UPDATE founders SET tier = ?, trial_ends_at = ?,
                  paid_through = COALESCE(?, paid_through)
            WHERE stripe_customer_id = ?`,
          [tier, trialEndsAt, paidThrough, sub.customer],
        );

        // A cancellation scheduled for the period end is the ordinary shape,
        // and the ordinary thing to do is confirm it and say when access
        // actually stops — which is not today.
        if ((sub as unknown as Record<string, unknown>).cancel_at_period_end === true) {
          const cancelling = await query(
            'SELECT id FROM founders WHERE stripe_customer_id = ?', [sub.customer]);
          const cancellingId = (cancelling.rows[0] as Record<string, string> | undefined)?.id;
          if (cancellingId) {
            await notifyOwnedCompanies(cancellingId, {
              kind: 'subscription_cancelled', effectiveAt: paidThrough,
            });
          }
        }

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
      // RECORD THE FACTS, THEN ASK THE RULE.
      //
      // This branch used to clear the tier and pause every product inline,
      // which cut the service off the instant a cancellation arrived. For a
      // period-end cancellation Stripe sends this event AT the period end, so
      // it usually looked right — but an immediate cancellation, a plan change
      // that deletes and recreates, or a refunded upgrade all ended service the
      // founder had already been charged for.
      //
      // The plan is over, so `tier` goes; the period they bought is not, so
      // `paid_through` stays and is refreshed from the subscription. Then
      // `applyEntitlementForFounder` — the same rule the hourly sweep runs —
      // decides whether that means paused. When the period really has ended,
      // that is immediate; when it has not, the sweep pauses them the hour it
      // does.
      const paidThrough = periodEndIso(sub);
      await query(
        `UPDATE founders SET tier = NULL, trial_ends_at = NULL,
                paid_through = COALESCE(?, paid_through)
          WHERE stripe_customer_id = ?`,
        [paidThrough, sub.customer]);
      const cancelledFounder = await query('SELECT id FROM founders WHERE stripe_customer_id = ?', [sub.customer]);
      if (cancelledFounder.rows.length > 0) {
        const founderId = (cancelledFounder.rows[0] as Record<string, string>).id;
        const { applyEntitlementForFounder } = await import('./entitlement.js');
        const { paused } = await applyEntitlementForFounder(founderId);
        // agent_instances is a second axis the scheduler does not read, but the
        // dashboard does. Kept in step with the products that actually paused,
        // rather than paused unconditionally.
        for (const productId of paused) {
          await query(
            `UPDATE agent_instances SET status = 'paused', updated_at = datetime('now')
              WHERE product_id = ?`, [productId]);
        }
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
        // And by email. An in-app notice reaches a founder who happens to log
        // in; a failed card is the one thing every subscription product emails
        // about, because the person who needs to act may not be looking.
        await notifyOwnedCompanies(founder.id, {
          kind: 'payment_failed',
          effectiveAt: String(invoice.id ?? ''),
        });
      }
      break;
    }

  }
}

// Tier codes are kept stable (`solo` / `growth` / `investor_ready`); the
// $399 tier's customer-facing name is "Scale" but its stable key stays
// `investor_ready` to avoid a DB migration. lookup_key = <app>_<tier>_monthly.
function lookupKeyFor(tier: string): string {
  return `${APP}_${tier}_monthly`;
}

const ENV_PRICE_FALLBACK: Record<string, string | undefined> = {
  get solo() { return process.env.STRIPE_SOLO_PRICE_ID; },
  get growth() { return process.env.STRIPE_GROWTH_PRICE_ID; },
  get investor_ready() { return process.env.STRIPE_INVESTOR_READY_PRICE_ID; },
};

// Resolve a tier's price by its native Stripe lookup_key, falling back to the
// legacy STRIPE_*_PRICE_ID env var until every price is backfilled with a key.
async function getPriceId(tier: string): Promise<string> {
  if (!(tier in ENV_PRICE_FALLBACK)) throw new Error(`Unknown tier: ${tier}`);
  try {
    const list = await getStripe().prices.list({ lookup_keys: [lookupKeyFor(tier)], active: true, limit: 1 });
    if (list.data[0]) return list.data[0].id;
  } catch { /* fall through to env fallback */ }
  const priceId = ENV_PRICE_FALLBACK[tier];
  if (!priceId) {
    throw new Error(`No price for tier '${tier}': set lookup_key '${lookupKeyFor(tier)}' in Stripe or STRIPE_${tier.toUpperCase()}_PRICE_ID`);
  }
  return priceId;
}

// Map an incoming price back to a tier. Prefer the price's own metadata
// (plan_key) — set by our backfill — and fall back to the env-var IDs.
function getTierFromPrice(priceId: string, priceObj?: Stripe.Price): string | null {
  const planKey = (priceObj?.metadata as Record<string, string> | undefined)?.plan_key;
  if (planKey && planKey in ENV_PRICE_FALLBACK) return planKey;
  if (priceId && priceId === process.env.STRIPE_SOLO_PRICE_ID) return 'solo';
  if (priceId && priceId === process.env.STRIPE_GROWTH_PRICE_ID) return 'growth';
  if (priceId && priceId === process.env.STRIPE_INVESTOR_READY_PRICE_ID) return 'investor_ready';
  return null;
}
