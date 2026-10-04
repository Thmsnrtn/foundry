// =============================================================================
// A WEEK OF A SUBSCRIPTION IS ONE DELIVERY, AND IT CANNOT GO UNHEARD.
//
//   a subscription link charges every week at its stated price, and its tag
//   rides on the subscription, never an intent → a link is offered only if it
//   is exactly that → a paid invoice is a payment, attributed by the
//   subscription's tag in the provider's current shape and its older one, or
//   by asking for the subscription when neither carries it → the checkout
//   that started it is not counted again → a refund on a subscription's charge
//   finds its week by the invoice → the ledger keys a week on its invoice, so
//   the webhook and the poll cannot record it twice → the poll finds a paid
//   week nobody announced → the buyer's address and the charge are read from
//   the provider when a delivery or a refund needs them.
//
// Nothing here can make a subscription start: the exchange is not available,
// and the owner's switch on Control is what lifts the rule against it.
// =============================================================================

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chargeOfInvoice, buyerAddressFor, paymentLinkParams, subscriptionInvoicesTheProviderKnowsOf, validateExperimentPaymentLink,
  type OfferPrice, type PaymentLinkFacts,
} from '../../src/services/venture/payment-link.js';
import { createPaymentLinkHandler } from '../../src/services/integration/stripe-gateway.js';
import { experimentOfSubscription, settlementFactsFromStripeEvent } from '../../src/services/venture/settlement-intake.js';
import { moneyFactsFromStripeEvent } from '../../src/services/economy/stripe-economics.js';

const X = 'exp_weekly';
const WEEKLY: OfferPrice = { amountCents: 900, currency: 'USD', lookupKey: `foundry_brief_${X}_weekly`, productName: 'Weekly bids brief',
  productMetadata: { app_object: 'experiment_deliverable', plan_key: `brief_${X}` }, confirmationMessage: 'Thanks', recurring: { interval: 'week' } };
const ONCE: OfferPrice = { ...WEEKLY, lookupKey: `foundry_brief_${X}_one_time`, recurring: undefined };

const link = (over: Partial<PaymentLinkFacts>, item: Partial<PaymentLinkFacts['lineItems'][number]> = {}): PaymentLinkFacts => ({
  id: 'plink_1', url: 'https://buy.stripe.com/test_1', active: true, metadata: { app: 'foundry', experiment_id: X },
  paymentIntentMetadata: {}, subscriptionMetadata: { app: 'foundry', experiment_id: X },
  lineItems: [{ unitAmount: 900, currency: 'USD', recurring: true, interval: 'week', quantity: 1, custom: null, ...item }], ...over,
});
type Stub = Record<string, unknown>;
const stubStripe = (routes: Record<string, Stub>) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const path = String(url).replace('https://api.stripe.com/v1', '');
  const hit = Object.keys(routes).find((k) => path.startsWith(k));
  return hit ? new Response(JSON.stringify(routes[hit]), { status: 200 }) : new Response('{}', { status: 404 });
}));
afterEach(() => { vi.unstubAllGlobals(); });

describe('a subscription link', () => {
  it('is offered only if it charges weekly at the stated price, tagged on the subscription', () => {
    expect(validateExperimentPaymentLink(link({}), X, WEEKLY)).toEqual({ ok: true, failures: [] });
    expect(validateExperimentPaymentLink(link({}, { recurring: false, interval: null }), X, WEEKLY).failures.join(' ')).toMatch(/one-time; the offer is a subscription/);
    expect(validateExperimentPaymentLink(link({}, { interval: 'month' }), X, WEEKLY).failures.join(' ')).toMatch(/every month, not every week/);
    expect(validateExperimentPaymentLink(link({ subscriptionMetadata: {} }), X, WEEKLY).failures.join(' ')).toMatch(/subscription is not tagged/);
    expect(validateExperimentPaymentLink(link({}, { custom: { minimum: 100, maximum: 1000, preset: 900 } }), X, WEEKLY).failures.join(' ')).toMatch(/stated price/);
  });

  it('a one-time offer still refuses a link that recurs', () => {
    expect(validateExperimentPaymentLink(link({ paymentIntentMetadata: { app: 'foundry', experiment_id: X } }), X, ONCE).failures.join(' ')).toMatch(/recurring; the offer is one-time/);
  });

  it('the act names the week and puts the tag on the subscription, not an intent', () => {
    const p = paymentLinkParams(X, WEEKLY);
    expect(p.recurring).toEqual({ interval: 'week' });
    expect(p.subscription_metadata).toEqual({ app: 'foundry', experiment_id: X, primitive: 'subscription' });
    expect(p.payment_intent_metadata).toBeUndefined();
    expect(paymentLinkParams(X, ONCE).subscription_metadata).toBeUndefined();
  });

  it('asks the provider for a weekly price and a subscription tag, and nothing on an intent', async () => {
    const bodies: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      bodies.push({ url, body: String(init?.body ?? '') });
      if (url.includes('/prices?')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.endsWith('/products')) return new Response(JSON.stringify({ id: 'prod_1' }), { status: 200 });
      if (url.endsWith('/prices')) return new Response(JSON.stringify({ id: 'price_1' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'plink_1', url: 'https://buy.stripe.com/test_1' }), { status: 200 });
    }));
    await createPaymentLinkHandler({ productId: 'p', tool: 't', action: 'a', params: paymentLinkParams(X, WEEKLY), dedupKey: 'k' } as never);
    const price = new URLSearchParams(bodies.find((b) => b.url.endsWith('/prices'))!.body);
    expect(price.get('recurring[interval]')).toBe('week');
    const made = new URLSearchParams(bodies.find((b) => b.url.endsWith('/payment_links'))!.body);
    expect(made.get('subscription_data[metadata][experiment_id]')).toBe(X);
    expect([...made.keys()].some((k) => k.startsWith('payment_intent_data'))).toBe(false);
  });

  it('refuses a subscription that lets the buyer choose, or carries no tag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const go = (params: Record<string, unknown>) => createPaymentLinkHandler({ productId: 'p', tool: 't', action: 'a', dedupKey: 'k', params } as never);
    await expect(go({ ...paymentLinkParams(X, WEEKLY), custom_amount: { minimum: 100, maximum: 1000, preset: 900 } })).rejects.toThrow(/weekly at its stated price/);
    await expect(go({ ...paymentLinkParams(X, WEEKLY), subscription_metadata: undefined })).rejects.toThrow(/tagged app=foundry/);
  });
});

describe('a paid week becomes a payment, attributed however the provider shaped it', () => {
  const invoice = (o: Record<string, unknown>) => settlementFactsFromStripeEvent({ id: 'evt', type: 'invoice.paid', created: 1_790_000_000,
    data: { object: { object: 'invoice', id: 'in_1', amount_paid: 900, currency: 'usd', customer_email: 'b@example.com', ...o } } });

  it('in the current shape, by the subscription details under its parent', () => {
    const [f] = invoice({ parent: { subscription_details: { subscription: 'sub_1', metadata: { app: 'foundry', experiment_id: X } } } });
    expect(f).toMatchObject({ experimentId: X, kind: 'payment', amountCents: 900, providerRef: 'in_1', paymentRef: 'in_1', subscriptionRef: 'sub_1' });
  });

  it('in the older shape, by the subscription details on the invoice itself', () => {
    const [f] = invoice({ subscription: 'sub_1', charge: 'ch_1', subscription_details: { metadata: { app: 'foundry', experiment_id: X } } });
    expect(f).toMatchObject({ experimentId: X, chargeRef: 'ch_1', subscriptionRef: 'sub_1' });
  });

  it('by asking for the subscription when the invoice carries no tag', async () => {
    const [f] = invoice({ subscription: 'sub_9' });
    expect(f).toMatchObject({ experimentId: null, subscriptionRef: 'sub_9' });
    stubStripe({ '/subscriptions/sub_9': { metadata: { app: 'foundry', experiment_id: X } } });
    expect(await experimentOfSubscription('sub_9')).toBe(X);
    stubStripe({ '/subscriptions/sub_8': { metadata: { app: 'somebody_else', experiment_id: X } } });
    expect(await experimentOfSubscription('sub_8')).toBeNull();
  });

  it('takes nothing from a week of nothing, or an invoice that is not a subscription of ours', () => {
    expect(invoice({ amount_paid: 0, subscription: 'sub_1' })).toEqual([]);
    expect(invoice({})).toEqual([]);
  });

  it('does not count the checkout that started it a second time', () => {
    expect(settlementFactsFromStripeEvent({ type: 'checkout.session.completed', data: { object: {
      object: 'checkout.session', mode: 'subscription', payment_status: 'paid', payment_intent: null,
      metadata: { app: 'foundry', experiment_id: X }, amount_total: 900 } } })).toEqual([]);
  });

  it('finds a refunded week by its invoice when the charge carries no tag', () => {
    const [f] = settlementFactsFromStripeEvent({ type: 'charge.refunded', data: { object: {
      object: 'charge', id: 'ch_1', invoice: 'in_1', currency: 'usd', amount_refunded: 900, refunds: { data: [{ id: 're_1', amount: 900 }] } } } });
    expect(f).toMatchObject({ experimentId: null, kind: 'refund', paymentRef: 'in_1', chargeRef: 'ch_1', settlesRef: 'in_1' });
  });
});

describe('the ledger records a week once', () => {
  it('keys the charge on its invoice, whether or not the charge was named', () => {
    const at = (o: Record<string, unknown>) => moneyFactsFromStripeEvent({ type: 'invoice.paid', data: { object: { object: 'invoice', id: 'in_1', amount_paid: 900, currency: 'usd', ...o } } });
    expect(at({ charge: 'ch_1' })[0]).toMatchObject({ kind: 'charge', providerRef: 'in_1:charge', chargeRef: 'ch_1', paymentRef: 'in_1', amountCents: 900 });
    expect(at({})[0]).toMatchObject({ providerRef: 'in_1:charge', chargeRef: null });
    expect(at({ amount_paid: 0 })).toEqual([]);
  });
});

describe('what the provider is asked, when it must be', () => {
  it('finds a paid week nobody announced, and only ours', async () => {
    stubStripe({
      '/invoices?': { has_more: false, data: [
        { id: 'in_ours', subscription: 'sub_1', subscription_details: { metadata: { app: 'foundry', experiment_id: X } } },
        { id: 'in_asked', parent: { subscription_details: { subscription: 'sub_2', metadata: {} } } },
        { id: 'in_theirs', subscription: 'sub_3', subscription_details: { metadata: { app: 'other', experiment_id: 'x' } } },
        { id: 'in_oneoff' },
      ] },
      '/subscriptions/sub_2': { metadata: { app: 'foundry', experiment_id: X } },
    });
    const found = (await subscriptionInvoicesTheProviderKnowsOf(1_790_000_000)).map((i) => i.id);
    expect(found).toEqual(['in_ours', 'in_asked']);
  });

  it('reads the buyer of a week from the invoice', async () => {
    stubStripe({ '/invoices/in_1': { customer_email: 'buyer@example.com' } });
    expect(await buyerAddressFor('in_1')).toBe('buyer@example.com');
  });

  it('finds the charge a refund must go against, in either shape', async () => {
    stubStripe({ '/invoices/in_old': { charge: 'ch_old' } });
    expect(await chargeOfInvoice('in_old')).toBe('ch_old');
    stubStripe({ '/invoices/in_new': { payments: { data: [{ payment: { payment_intent: 'pi_1' } }] } }, '/payment_intents/pi_1': { latest_charge: 'ch_new' } });
    expect(await chargeOfInvoice('in_new')).toBe('ch_new');
  });
});
