// =============================================================================
// PAY WHAT IT WAS WORTH: GIVEN FIRST, PAID FOR BY CHOICE, AND SAID SO.
//
//   the owner allowed "deliver first, the buyer pays what they judge fair,
//   including nothing" (PENDING 31) → the provider holds a price the buyer
//   chooses, with a suggestion, a dollar floor and a ceiling, and no fixed
//   amount → a link is offered only if it is exactly that → a fixed-price
//   offer refuses a link that lets the buyer choose, and the other way round
//   → the page gives the thing first, says paying nothing is fine, still says
//   nothing renews, and claims no machine-read price.
// =============================================================================

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { paymentLinkParams, validateExperimentPaymentLink, type OfferPrice, type PaymentLinkFacts } from '../../src/services/venture/payment-link.js';
import { createPaymentLinkHandler } from '../../src/services/integration/stripe-gateway.js';
import { CHOSEN_BAND, EXCHANGES_THE_HANDS_CARRY } from '../../src/services/venture/products/offer-composition.js';
import { renderExperiment } from '../../src/services/public-workshop/site.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

const X = 'exp_pwyw';
const CHOSEN: OfferPrice = { amountCents: 1200, currency: 'USD', lookupKey: `foundry_brief_${X}_chosen`, productName: 'Bids brief',
  productMetadata: { app_object: 'experiment_deliverable', plan_key: `brief_${X}` }, confirmationMessage: 'Thanks', chosen: { ...CHOSEN_BAND } };
const FIXED: OfferPrice = { ...CHOSEN, lookupKey: `foundry_brief_${X}_one_time`, chosen: undefined };

const link = (item: Partial<PaymentLinkFacts['lineItems'][number]>): PaymentLinkFacts => ({
  id: 'plink_1', url: 'https://buy.stripe.com/test_1', active: true,
  metadata: { app: 'foundry', experiment_id: X }, paymentIntentMetadata: { app: 'foundry', experiment_id: X },
  lineItems: [{ unitAmount: null, currency: 'USD', recurring: false, quantity: 1, custom: null, ...item }],
});
const chosenLink = link({ custom: { minimum: 100, maximum: 10_000, preset: 1200 } });
const fixedLink = link({ unitAmount: 1200 });

afterEach(() => { vi.unstubAllGlobals(); });

describe('the owner\'s word', () => {
  it('the hands carry it, between a dollar and a hundred', () => {
    expect(EXCHANGES_THE_HANDS_CARRY).toContain('value_first');
    expect(CHOSEN_BAND.minimumCents).toBeGreaterThanOrEqual(50);
    expect(CHOSEN_BAND.minimumCents).toBe(100);
    expect(CHOSEN_BAND.maximumCents).toBe(10_000);
  });
});

describe('a link is offered only if it is exactly what the page says', () => {
  it('accepts a chosen-amount link with the same suggestion, floor and ceiling', () => {
    expect(validateExperimentPaymentLink(chosenLink, X, CHOSEN)).toEqual({ ok: true, failures: [] });
  });

  it('refuses a fixed price where the buyer was promised the choice', () => {
    expect(validateExperimentPaymentLink(fixedLink, X, CHOSEN).failures.join(' ')).toMatch(/the price is fixed/);
  });

  it('refuses a chosen amount where the page states a fixed price', () => {
    expect(validateExperimentPaymentLink(chosenLink, X, FIXED).failures.join(' ')).toMatch(/the buyer may choose the amount/);
  });

  it('refuses a different suggestion, floor or ceiling', () => {
    const off = (c: { minimum: number; maximum: number; preset: number }) => validateExperimentPaymentLink(link({ custom: c }), X, CHOSEN).failures.join(' ');
    expect(off({ minimum: 100, maximum: 10_000, preset: 900 })).toMatch(/suggested amount is 9.00, not 12.00/);
    expect(off({ minimum: 50, maximum: 10_000, preset: 1200 })).toMatch(/floor is 0.50, not 1.00/);
    expect(off({ minimum: 100, maximum: 50_000, preset: 1200 })).toMatch(/ceiling is 500.00, not 100.00/);
  });

  it('still refuses a recurring price, whatever the amount', () => {
    expect(validateExperimentPaymentLink(link({ custom: { minimum: 100, maximum: 10_000, preset: 1200 }, recurring: true }), X, CHOSEN).failures.join(' ')).toMatch(/recurring/);
  });
});

describe('what is asked of the provider', () => {
  it('the act names the bounds, so what is approved is what is created', () => {
    const p = paymentLinkParams(X, CHOSEN);
    expect(p.custom_amount).toEqual({ minimum: 100, maximum: 10_000, preset: 1200 });
    expect(p.unit_amount).toBe(1200);
    expect((p.price_metadata as Record<string, string>).pricing).toBe('chosen_by_buyer');
    expect(paymentLinkParams(X, FIXED).custom_amount).toBeUndefined();
  });

  it('creates a price the buyer chooses, and no fixed amount, at the provider', async () => {
    const bodies: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      bodies.push({ url, body: String(init?.body ?? '') });
      if (url.includes('/prices?')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.endsWith('/products')) return new Response(JSON.stringify({ id: 'prod_1' }), { status: 200 });
      if (url.endsWith('/prices')) return new Response(JSON.stringify({ id: 'price_1' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'plink_1', url: 'https://buy.stripe.com/test_1' }), { status: 200 });
    }));
    await createPaymentLinkHandler({ productId: 'p', tool: 'stripe_create_payment_link', action: 'a', params: paymentLinkParams(X, CHOSEN), dedupKey: 'k' } as never);
    const price = new URLSearchParams(bodies.find((b) => b.url.endsWith('/prices'))!.body);
    expect(price.get('custom_unit_amount[enabled]')).toBe('true');
    expect(price.get('custom_unit_amount[minimum]')).toBe('100');
    expect(price.get('custom_unit_amount[maximum]')).toBe('10000');
    expect(price.get('custom_unit_amount[preset]')).toBe('1200');
    expect(price.get('unit_amount')).toBeNull();
  });

  it('refuses bounds the provider would reject or a suggestion outside them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const bad = (custom_amount: unknown, unit_amount = 1200) => createPaymentLinkHandler({ productId: 'p', tool: 't', action: 'a', dedupKey: 'k',
      params: { ...paymentLinkParams(X, CHOSEN), custom_amount, unit_amount } } as never);
    await expect(bad({ minimum: 10, maximum: 10_000, preset: 1200 })).rejects.toThrow(/floor of at least 50/);
    await expect(bad({ minimum: 100, maximum: 1000, preset: 1200 })).rejects.toThrow(/suggestion between floor and ceiling/);
    await expect(bad({ minimum: 100, maximum: 10_000, preset: 1200 }, 900)).rejects.toThrow(/suggestion as unit_amount/);
  });
});

describe('the page gives first and says so', () => {
  const facts = { name: 'Apex Micro', region: 'Massachusetts', contactEmail: 'thomas@apexmicro.ai', origin: 'https://apexmicro.ai',
    tagline: 't', statement: 's', about: 'a', postalAddress: 'PO Box 1', legalOperator: 'x', replyRouteProven: false } as unknown as PublicWorkshopFacts;
  const base = {
    number: 3, slug: 'bids', path: '/experiments/bids', listed: true, title: 'Open bids this week', summary: 'A shortlist.',
    who: 'Contractors', what: 'A list', limits: 'Not everything', sources: 'Public records', selection: 'Nobody was written to.', note: 'A pilot.',
    sample: 'One item', tool: null, status: 'testing', statusLabel: 'Pilot', statusLine: 'Open now', outcome: null, whereToGetIt: null,
    shape: 'product_page', clarification: null, recurring: false, payUrl: 'https://buy.stripe.com/test_1',
    openedOn: '2026-10-04', closedOn: null, updatedOn: '2026-10-04', supersedes: null, successor: null, graduatedTo: null,
  };
  const given = { ...base, freeToRead: 'THE WHOLE BRIEF: item one, item two.',
    price: { amountCents: 1200, currency: 'USD', label: 'pay what it was worth, $12 suggested', chosen: { minimumCents: 100, maximumCents: 10_000 } } } as unknown as PublicExperiment;
  const sold = { ...base, freeToRead: null, price: { amountCents: 1200, currency: 'USD', label: '$12, one time' } } as unknown as PublicExperiment;

  it('carries the thing whole, before any payment', () => {
    const html = renderExperiment(facts, given);
    expect(html).toContain('THE WHOLE BRIEF: item one, item two.');
    expect(html).toContain('Nothing to pay before you read it');
  });

  it('says paying nothing is fine, and that nothing renews', () => {
    const html = renderExperiment(facts, given);
    expect(html).toMatch(/paying nothing is fine/);
    expect(html).toMatch(/No subscription, nothing renews/);
    expect(html).toContain('>Pay what it was worth<');
    expect(html).not.toMatch(/Buy for \$12/);
  });

  it('claims no machine-read price for an amount the buyer chooses', () => {
    expect(renderExperiment(facts, given)).not.toContain('application/ld+json');
    expect(renderExperiment(facts, sold)).toContain('application/ld+json');
  });

  it('leaves a fixed-price page as it was: a price, a sample, and no free copy', () => {
    const html = renderExperiment(facts, sold);
    expect(html).toContain('Buy for $12');
    expect(html).toContain('One item');
    expect(html).not.toContain('Nothing to pay before you read it');
  });
});
