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

export interface OfferPrice { amountCents: number; currency: string; lookupKey: string; productName: string; productMetadata: Record<string, string>; confirmationMessage: string }

export interface PaymentLinkFacts {
  id: string; url: string; active: boolean; metadata: Record<string, string>; paymentIntentMetadata: Record<string, string>;
  lineItems: Array<{ unitAmount: number | null; currency: string; recurring: boolean; quantity: number }>;
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

interface RawLink { id: string; url: string; active: boolean; metadata?: Record<string, string>; payment_intent_data?: { metadata?: Record<string, string> } | null }

async function linkFacts(link: RawLink): Promise<PaymentLinkFacts> {
  const items = await stripeGet<{ data: Array<{ quantity: number; price: { unit_amount: number | null; currency: string; recurring: unknown | null } }> }>(`/payment_links/${pathSegment(link.id, 'payment_link_id')}/line_items?limit=10`);
  return {
    id: link.id, url: link.url, active: link.active, metadata: link.metadata ?? {}, paymentIntentMetadata: link.payment_intent_data?.metadata ?? {},
    lineItems: items.data.map((i) => ({ unitAmount: i.price.unit_amount, currency: i.price.currency.toUpperCase(), recurring: i.price.recurring != null, quantity: i.quantity })),
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
export function validateExperimentPaymentLink(link: PaymentLinkFacts, experimentId: string, price: { amountCents: number; currency: string }): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!link.active) failures.push('the link is not active');
  if (!/^https:\/\/buy\.stripe\.com\//.test(link.url)) failures.push('not a Stripe Payment Link URL');
  if ((link.metadata.app ?? '') !== 'foundry') failures.push('the link is not tagged app=foundry');
  if (link.metadata.experiment_id !== experimentId) failures.push(`the link is not tagged for this experiment (experiment_id=${link.metadata.experiment_id ?? 'missing'})`);
  if (link.paymentIntentMetadata.experiment_id !== experimentId) failures.push('the payment itself is not tagged for this experiment (payment intent metadata)');
  if (link.lineItems.length !== 1) failures.push(`expected one line item, found ${link.lineItems.length}`);
  const item = link.lineItems[0];
  if (item) {
    if (item.recurring) failures.push('the price is recurring; the offer is one-time');
    if (item.unitAmount !== price.amountCents) failures.push(`the price is ${item.unitAmount == null ? 'unset' : (item.unitAmount / 100).toFixed(2)}, not ${(price.amountCents / 100).toFixed(2)}`);
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
    price_metadata: { app: 'foundry', plan_key: p.productMetadata.plan_key ?? p.lookupKey, billing_period: 'one_time' },
    link_metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' },
    payment_intent_metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' },
    confirmation_message: p.confirmationMessage,
  };
}

export async function createExperimentPaymentLink(input: { productId: string; experimentId: string; price: OfferPrice }): Promise<{ link: PaymentLinkFacts } | { refused: string }> {
  const p = input.price;
  const result = await invoke({
    productId: input.productId, tool: 'stripe_create_payment_link',
    action: `create the ${p.currency.toUpperCase()} ${(p.amountCents / 100).toFixed(2)} one-time payment link for experiment ${input.experimentId}`,
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

/** The buyer's address for one payment, read from the provider at delivery time and never stored in a ledger. */
export async function buyerAddressFor(paymentIntentId: string): Promise<string | null> {
  const pi = await stripeGet<{ receipt_email?: string | null; latest_charge?: string | { billing_details?: { email?: string | null } } | null }>(`/payment_intents/${pathSegment(paymentIntentId, 'payment_intent_id')}?expand[]=latest_charge`);
  if (pi.receipt_email) return pi.receipt_email;
  const charge = pi.latest_charge;
  if (charge && typeof charge === 'object' && charge.billing_details?.email) return charge.billing_details.email;
  return null;
}
