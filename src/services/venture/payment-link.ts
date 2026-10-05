// =============================================================================
// THE OFFER IS A PAYMENT LINK, AND THE LINK IS THE EXPOSURE
//
// A real experiment's offer is placed somewhere a stranger can reach it. For
// the first real experiment that place is a Stripe Payment Link on the owner's
// shared account, tagged so the billing webhook can attribute every settlement
// back to the test (docs/stripe-shared-account.md). Creating the catalog
// objects moves no money; it is a `public` act through the governed door (kill
// switch, dedup, audit). A link the owner made by hand is read back from Stripe
// and held to the same contract, so a wrong or untagged link never proceeds.
//
// Nothing here stores payer identity. The link id is the `exposure_ref`
// (migration 278: "a checkout link id, opaque to the institution").
// =============================================================================

// THE GOVERNED DOOR ONLY EXISTS IF SOMEBODY OPENS IT.
//
// `stripe-gateway.ts` registers its tool handlers as a side effect of being
// imported, and for a long time nothing imported it. The registry was therefore
// empty in every process that mattered, and every call through the governed
// door came back "no trusted policy registered for tool
// 'stripe_create_payment_link'" — which is a correct refusal to an act that
// should have been possible.
//
// It failed closed, which is the right direction, but it failed INVISIBLY: an
// authorised experiment sat for hours unable to place its offer while the
// hourly pass reported success. A direct call to Stripe with the credential
// worked perfectly the whole time, which is exactly why that is not evidence
// of anything. The institution's own path is the only path worth testing.
//
// This import is load-bearing. It is not a convenience and it is not unused:
// removing it disarms every Stripe capability in this system.
import '../integration/stripe-gateway.js';
import { invoke } from '../outbound/gateway.js';
import { withRetry } from '../resilience.js';
import { pathSegment } from '../outbound/path-segment.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_TIMEOUT_MS = 10_000;

export interface OfferPrice {
  /** The price — or, when the buyer chooses, the amount suggested to them. */
  amountCents: number; currency: string; lookupKey: string; productName: string; productMetadata: Record<string, string>; confirmationMessage: string;
  /**
   * PAY WHAT IT WAS WORTH (`value_first`, PENDING 31): the buyer chooses the
   * amount, between these bounds, with `amountCents` suggested. Absent for a
   * fixed price. The floor is three dollars (R29, CHOSEN_BAND): below it the
   * card fee is a fifth or more of the money; paying nothing at all is not
   * paying, and is allowed.
   */
  chosen?: { minimumCents: number; maximumCents: number };
  /**
   * A SUBSCRIPTION (`subscription`, PENDING 31, allowed by his own act on
   * Control): charged every week until cancelled, each paid invoice one
   * delivery. Absent for anything bought once. Never combined with `chosen`.
   */
  recurring?: { interval: 'week' };
}

export interface PaymentLinkFacts {
  id: string; url: string; active: boolean; metadata: Record<string, string>; paymentIntentMetadata: Record<string, string>;
  /** What every subscription the link starts will carry; empty for a one-time link. */
  subscriptionMetadata: Record<string, string>;
  lineItems: Array<{ unitAmount: number | null; currency: string; recurring: boolean; interval: string | null; quantity: number;
    /** The bounds and suggestion of a price the buyer chooses, or null for a fixed one. */
    custom: { minimum: number | null; maximum: number | null; preset: number | null } | null }>;
}

function stripeKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && key.trim() ? key : null;
}

export function paymentCapabilityConfigured(): boolean {
  return stripeKey() !== null;
}

async function stripeGet<T>(path: string): Promise<T> {
  const key = stripeKey();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  const response = await withRetry(() => fetch(`${STRIPE_API}${path}`, { headers: { Authorization: `Bearer ${key}` } }), { timeoutMs: STRIPE_TIMEOUT_MS, maxRetries: 2 });
  if (!response.ok) throw new Error(`Stripe ${path} ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return (await response.json()) as T;
}

interface RawLink { id: string; url: string; active: boolean; metadata?: Record<string, string>; payment_intent_data?: { metadata?: Record<string, string> } | null;
  subscription_data?: { metadata?: Record<string, string> } | null }

async function linkFacts(link: RawLink): Promise<PaymentLinkFacts> {
  const items = await stripeGet<{ data: Array<{ quantity: number; price: { unit_amount: number | null; currency: string; recurring: { interval?: string } | null;
    custom_unit_amount?: { minimum?: number | null; maximum?: number | null; preset?: number | null } | null } }> }>(`/payment_links/${pathSegment(link.id, 'payment_link_id')}/line_items?limit=10`);
  return {
    id: link.id, url: link.url, active: link.active, metadata: link.metadata ?? {}, paymentIntentMetadata: link.payment_intent_data?.metadata ?? {},
    subscriptionMetadata: link.subscription_data?.metadata ?? {},
    lineItems: items.data.map((i) => ({ unitAmount: i.price.unit_amount, currency: i.price.currency.toUpperCase(), recurring: i.price.recurring != null,
      interval: i.price.recurring?.interval ?? null, quantity: i.quantity,
      custom: i.price.custom_unit_amount ? { minimum: i.price.custom_unit_amount.minimum ?? null, maximum: i.price.custom_unit_amount.maximum ?? null, preset: i.price.custom_unit_amount.preset ?? null } : null })),
  };
}

async function listActiveLinks(): Promise<RawLink[]> {
  const out: RawLink[] = [];
  let after: string | null = null;
  for (let pageNo = 0; pageNo < 5; pageNo++) {
    const res: { data: RawLink[]; has_more: boolean } = await stripeGet<{ data: RawLink[]; has_more: boolean }>(`/payment_links?active=true&limit=100${after ? `&starting_after=${after}` : ''}`);
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    after = res.data[res.data.length - 1].id;
  }
  return out;
}

/**
 * WHAT THE PROVIDER KNOWS IT TOOK, since a moment. Succeeded payments only,
 * tagged as ours: a charge at somebody else's link is not this institution's
 * business to read, and the intake refuses it anyway.
 *
 * This is a read. It moves no money, so it does not go through the governed
 * door that authorises effects — but it is the only way to find out that money
 * moved and nobody told us, which is why it exists.
 */
export async function paymentsTheProviderKnowsOf(sinceUnix: number): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let after: string | null = null;
  for (let pageNo = 0; pageNo < 5; pageNo += 1) {
    const res: { data: Array<Record<string, unknown>>; has_more: boolean } = await stripeGet<{ data: Array<Record<string, unknown>>; has_more: boolean }>(
      `/payment_intents?created[gte]=${String(sinceUnix)}&limit=100${after ? `&starting_after=${after}` : ''}`);
    for (const intent of res.data) {
      if (String(intent.status) !== 'succeeded') continue;
      const meta = intent.metadata as Record<string, string> | undefined;
      if (!meta || typeof meta.experiment_id !== 'string' || meta.experiment_id.trim() === '') continue;
      if (meta.app != null && meta.app !== 'foundry') continue;
      out.push({ ...intent, object: 'payment_intent' });
    }
    if (!res.has_more || res.data.length === 0) break;
    after = String(res.data[res.data.length - 1].id);
  }
  return out;
}

/** The active link at this URL, read from Stripe; null when there is none. */
export async function describePaymentLink(url: string): Promise<PaymentLinkFacts | null> {
  const wanted = url.trim();
  const link = (await listActiveLinks()).find((l) => l.url === wanted);
  return link ? linkFacts(link) : null;
}

/** The active link Stripe already holds for this experiment, if one was made before. */
export async function findExperimentPaymentLink(experimentId: string): Promise<PaymentLinkFacts | null> {
  const link = (await listActiveLinks()).find((l) => (l.metadata?.app ?? 'foundry') === 'foundry' && l.metadata?.experiment_id === experimentId);
  return link ? linkFacts(link) : null;
}

/** The contract a link must meet before it may be offered to anyone. */
export function validateExperimentPaymentLink(link: PaymentLinkFacts, experimentId: string, price: { amountCents: number; currency: string; chosen?: OfferPrice['chosen']; recurring?: OfferPrice['recurring'] }): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!link.active) failures.push('the link is not active');
  if (!/^https:\/\/buy\.stripe\.com\//.test(link.url)) failures.push('not a Stripe Payment Link URL');
  if ((link.metadata.app ?? '') !== 'foundry') failures.push('the link is not tagged app=foundry');
  if (link.metadata.experiment_id !== experimentId) failures.push(`the link is not tagged for this experiment (experiment_id=${link.metadata.experiment_id ?? 'missing'})`);
  // A ONE-TIME PAYMENT carries the tag on its intent; a SUBSCRIPTION carries
  // it on the subscription every invoice belongs to. Each is checked where it
  // lives.
  if (price.recurring) {
    if (link.subscriptionMetadata.experiment_id !== experimentId) failures.push('the subscription is not tagged for this experiment (subscription metadata)');
  } else if (link.paymentIntentMetadata.experiment_id !== experimentId) failures.push('the payment itself is not tagged for this experiment (payment intent metadata)');
  if (link.lineItems.length !== 1) failures.push(`expected one line item, found ${link.lineItems.length}`);
  const item = link.lineItems[0];
  if (item) {
    if (price.recurring) {
      if (!item.recurring) failures.push('the price is one-time; the offer is a subscription');
      else if (item.interval !== price.recurring.interval) failures.push(`the price recurs every ${item.interval ?? '?'}, not every ${price.recurring.interval}`);
      if (item.custom) failures.push('a subscription is charged at its stated price; this one lets the buyer choose');
    } else if (item.recurring) failures.push('the price is recurring; the offer is one-time');
    if (price.chosen) {
      // THE BUYER CHOOSES, AND THE LINK MUST SAY EXACTLY WHAT THE PAGE SAYS:
      // the suggestion, the floor and the ceiling, and no fixed amount at all.
      const c = item.custom;
      if (!c) failures.push('the price is fixed; this offer lets the buyer choose');
      else {
        if (c.preset !== price.amountCents) failures.push(`the suggested amount is ${c.preset == null ? 'unset' : (c.preset / 100).toFixed(2)}, not ${(price.amountCents / 100).toFixed(2)}`);
        if (c.minimum !== price.chosen.minimumCents) failures.push(`the floor is ${c.minimum == null ? 'unset' : (c.minimum / 100).toFixed(2)}, not ${(price.chosen.minimumCents / 100).toFixed(2)}`);
        if (c.maximum !== price.chosen.maximumCents) failures.push(`the ceiling is ${c.maximum == null ? 'unset' : (c.maximum / 100).toFixed(2)}, not ${(price.chosen.maximumCents / 100).toFixed(2)}`);
      }
    } else {
      if (item.custom) failures.push('the buyer may choose the amount; this offer has a fixed price');
      if (item.unitAmount !== price.amountCents) failures.push(`the price is ${item.unitAmount == null ? 'unset' : (item.unitAmount / 100).toFixed(2)}, not ${(price.amountCents / 100).toFixed(2)}`);
    }
    if (item.currency !== price.currency.toUpperCase()) failures.push(`the currency is ${item.currency}, not ${price.currency.toUpperCase()}`);
    if (item.quantity !== 1) failures.push('quantity is not fixed at 1');
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Create the link through the governed door (tool `stripe_create_payment_link`,
 * registered in integration/stripe-gateway.ts). Idempotent by dedup key and by
 * the price's lookup key: a second call finds the existing objects.
 */
/** EXACTLY WHAT WILL BE CREATED, computed once: the act the owner approves at
 * Allow is fingerprinted over these, and the door spends that approval only
 * against the same values. */
export function paymentLinkParams(experimentId: string, p: OfferPrice): Record<string, unknown> {
  return {
    product_name: p.productName, product_metadata: { app: 'foundry', ...p.productMetadata },
    price_lookup_key: p.lookupKey, unit_amount: p.amountCents, currency: p.currency.toLowerCase(),
    price_metadata: { app: 'foundry', plan_key: p.productMetadata.plan_key ?? p.lookupKey, billing_period: p.recurring ? p.recurring.interval : 'one_time', ...(p.chosen ? { pricing: 'chosen_by_buyer' } : {}) },
    ...(p.chosen ? { custom_amount: { minimum: p.chosen.minimumCents, maximum: p.chosen.maximumCents, preset: p.amountCents } } : {}),
    link_metadata: { app: 'foundry', experiment_id: experimentId, primitive: p.recurring ? 'subscription' : 'sale' },
    ...(p.recurring
      ? { recurring: { interval: p.recurring.interval }, subscription_metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'subscription' } }
      : { payment_intent_metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' } }),
    confirmation_message: p.confirmationMessage,
  };
}

export async function createExperimentPaymentLink(input: { productId: string; experimentId: string; price: OfferPrice }): Promise<{ link: PaymentLinkFacts } | { refused: string }> {
  const p = input.price;
  const result = await invoke({
    productId: input.productId, tool: 'stripe_create_payment_link',
    action: p.recurring
      ? `create the ${p.currency.toUpperCase()} ${(p.amountCents / 100).toFixed(2)}-a-${p.recurring.interval} subscription link for experiment ${input.experimentId}`
      : p.chosen
      ? `create the pay-what-it-was-worth payment link for experiment ${input.experimentId}, suggesting ${p.currency.toUpperCase()} ${(p.amountCents / 100).toFixed(2)}`
      : `create the ${p.currency.toUpperCase()} ${(p.amountCents / 100).toFixed(2)} one-time payment link for experiment ${input.experimentId}`,
    params: paymentLinkParams(input.experimentId, p),
    dedupKey: `experiment:${input.experimentId}:payment_link`, customerExternalId: `experiment:${input.experimentId}`,
    surface: 'billing', dataClass: 'customer',
  });
  if (!result.ok) return { refused: `${result.phase}: ${result.reason}` };
  const created = result.result as { id: string; url: string };
  const facts = await describePaymentLink(created.url);
  if (!facts) return { refused: 'the link was created but Stripe did not list it yet; try again in a moment' };
  return { link: facts };
}

/**
 * THE WEEKS OF SUBSCRIPTIONS THE PROVIDER KNOWS WERE PAID, since a moment, and
 * that belong to a subscription of ours. Each invoice says whose it is through
 * its subscription's tag; one that does not say is asked about by name. A
 * read, like the intents above: the only way to find a week that was paid and
 * never announced.
 */
export async function subscriptionInvoicesTheProviderKnowsOf(sinceUnix: number): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const tags = new Map<string, Record<string, string> | null>();
  let after: string | null = null;
  for (let pageNo = 0; pageNo < 5; pageNo += 1) {
    const res: { data: Array<Record<string, unknown>>; has_more: boolean } = await stripeGet<{ data: Array<Record<string, unknown>>; has_more: boolean }>(
      `/invoices?status=paid&created[gte]=${String(sinceUnix)}&limit=100${after ? `&starting_after=${after}` : ''}`);
    for (const inv of res.data) {
      const parent = inv.parent as { subscription_details?: { subscription?: unknown; metadata?: Record<string, string> | null } | null } | null | undefined;
      const sub = typeof parent?.subscription_details?.subscription === 'string' ? parent.subscription_details.subscription
        : typeof inv.subscription === 'string' ? inv.subscription : null;
      if (!sub) continue;
      let meta = parent?.subscription_details?.metadata ?? (inv.subscription_details as { metadata?: Record<string, string> | null } | undefined)?.metadata ?? null;
      if (!meta?.experiment_id) {
        if (!tags.has(sub)) tags.set(sub, await subscriptionTag(sub).catch(() => null));
        meta = tags.get(sub) ?? null;
      }
      if (!meta || typeof meta.experiment_id !== 'string' || meta.experiment_id.trim() === '') continue;
      if (meta.app != null && meta.app !== 'foundry') continue;
      out.push({ ...inv, object: 'invoice' });
    }
    if (!res.has_more || res.data.length === 0) break;
    after = String(res.data[res.data.length - 1]!.id);
  }
  return out;
}

/**
 * THE CHARGE BEHIND A PAID INVOICE: named on the invoice in older shapes,
 * reached through its payment in newer ones. A refund moves money against a
 * charge, never an invoice, so a week that is owed a refund needs this.
 */
export async function chargeOfInvoice(invoiceId: string): Promise<string | null> {
  const inv = await stripeGet<{ charge?: string | { id?: string } | null; payment_intent?: string | null;
    payments?: { data?: Array<{ payment?: { charge?: string | null; payment_intent?: string | null } }> } }>(
    `/invoices/${pathSegment(invoiceId, 'invoice_id')}?expand[]=payments`);
  if (typeof inv.charge === 'string') return inv.charge;
  if (inv.charge && typeof inv.charge === 'object' && inv.charge.id) return inv.charge.id;
  const paid = inv.payments?.data?.find((p) => p.payment?.charge || p.payment?.payment_intent)?.payment;
  if (paid?.charge) return paid.charge;
  const intent = paid?.payment_intent ?? inv.payment_intent ?? null;
  if (!intent) return null;
  const pi = await stripeGet<{ latest_charge?: string | null }>(`/payment_intents/${pathSegment(intent, 'payment_intent_id')}`);
  return pi.latest_charge ?? null;
}

/** A subscription's own tag at the provider. A read, never an effect. */
export async function subscriptionTag(subscriptionId: string): Promise<Record<string, string> | null> {
  const sub = await stripeGet<{ metadata?: Record<string, string> | null }>(`/subscriptions/${pathSegment(subscriptionId, 'subscription_id')}`);
  return sub.metadata ?? null;
}

/**
 * WHETHER A SUBSCRIPTION WILL CHARGE AGAIN. Ended, or set to end with its
 * current period, is stopped — however it got there: the buyer at the
 * provider, a card that kept failing, or an earlier stop. A read, never an effect.
 */
export async function subscriptionHasStopped(subscriptionId: string): Promise<boolean> {
  const sub = await stripeGet<{ status?: string | null; cancel_at_period_end?: boolean | null; canceled_at?: number | null }>(
    `/subscriptions/${pathSegment(subscriptionId, 'subscription_id')}`);
  return sub.status === 'canceled' || sub.status === 'incomplete_expired' || sub.cancel_at_period_end === true || sub.canceled_at != null;
}

/** The buyer's address for one payment, read from the provider at delivery time and never stored in a ledger. */
export async function buyerAddressFor(paymentIntentId: string): Promise<string | null> {
  // A SUBSCRIPTION'S DELIVERY IS OWED PER INVOICE, and an invoice names its
  // customer's address itself; read at delivery like the intent's, never kept.
  if (paymentIntentId.startsWith('in_')) {
    const inv = await stripeGet<{ customer_email?: string | null }>(`/invoices/${pathSegment(paymentIntentId, 'invoice_id')}`);
    return inv.customer_email ?? null;
  }
  const pi = await stripeGet<{ receipt_email?: string | null; latest_charge?: string | { billing_details?: { email?: string | null } } | null }>(`/payment_intents/${pathSegment(paymentIntentId, 'payment_intent_id')}?expand[]=latest_charge`);
  if (pi.receipt_email) return pi.receipt_email;
  const charge = pi.latest_charge;
  if (charge && typeof charge === 'object' && charge.billing_details?.email) return charge.billing_details.email;
  return null;
}
