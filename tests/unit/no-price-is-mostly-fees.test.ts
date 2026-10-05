// =============================================================================
// LAW (Roadmap 2027 R29): NO PRICE IS MOSTLY FEES.
//
// A price the provider takes a fifth or more of, before anything else is
// counted, leaves too little to read a contribution from and teaches nothing
// about what the thing is worth. The fee is estimated from each venue's
// published rate card (the estimate is named as one, with its source), and a
// price is refused where the lowest amount a buyer could pay loses a fifth.
// A buyer's chosen amount now starts at three dollars, not one: at a dollar
// the card fee is a third of the money.
//
// Refused at every point a price passes: the composition that proposes it,
// the readiness that lets the owner allow it, and the door that mints a link.
// A free offer has no fee and is not refused.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '2'.repeat(64);

import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { estimatedFeeCents, FEE_CARDS, lowestPayableCents, MOST_A_FEE_MAY_TAKE, priceIsMostlyFees } from '../../src/services/venture/fee-floor.js';
import { CHOSEN_BAND, OFFER_BAND, WEEKLY_BAND } from '../../src/services/venture/products/offer-composition.js';

describe('the fee is an estimate from a published card, and says so', () => {
  it('each venue names its rate card and where it was read', () => {
    for (const card of Object.values(FEE_CARDS)) {
      expect(card.source).toMatch(/^https:\/\//);
      expect(card.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('Stripe: 2.9% and 30 cents; Etsy: 20 cents to list, 6.5% of the sale, 3% and 25 cents to process', () => {
    expect(estimatedFeeCents('stripe', 1000)).toBe(59);
    expect(estimatedFeeCents('stripe', 300)).toBe(39);
    expect(estimatedFeeCents('etsy', 1400)).toBe(178);
    expect(estimatedFeeCents('etsy', 300)).toBe(74);
  });
});

describe('what is refused', () => {
  it('a dollar on Stripe loses a third and is refused; three dollars loses an eighth and is not', () => {
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: 100 })).toMatch(/\$0\.33 of \$1\.00/);
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: 300 })).toBeNull();
  });
  it('three dollars on Etsy loses about a quarter and is refused; five does not', () => {
    expect(priceIsMostlyFees({ venue: 'etsy', amountCents: 300 })).toMatch(/Etsy/);
    expect(priceIsMostlyFees({ venue: 'etsy', amountCents: 500 })).toBeNull();
  });
  it('a chosen amount is judged at the least a buyer could pay, not the suggestion', () => {
    expect(lowestPayableCents({ amountCents: 1200, chosen: { minimumCents: 100, maximumCents: 10_000 } })).toBe(100);
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: 1200, chosen: { minimumCents: 100, maximumCents: 10_000 } })).toMatch(/least a buyer could pay/);
  });
  it('nothing to pay is no fee, and not refused', () => {
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: 0 })).toBeNull();
  });
  it('the line is a fifth', () => { expect(MOST_A_FEE_MAY_TAKE).toBe(0.2); });
});

describe('the bands the forge composes inside clear the floor', () => {
  it('the chosen floor is three dollars, and every band\'s lowest price passes on Stripe', () => {
    expect(CHOSEN_BAND.minimumCents).toBe(300);
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: OFFER_BAND.lowDollars * 100 })).toBeNull();
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: WEEKLY_BAND.lowDollars * 100 })).toBeNull();
    expect(priceIsMostlyFees({ venue: 'stripe', amountCents: 1200, chosen: { ...CHOSEN_BAND } })).toBeNull();
  });
});

describe('every point a price passes refuses it', () => {
  it('the composition refuses a proposed price the floor refuses', () => {
    const src = readFileSync('src/services/venture/products/offer-composition.ts', 'utf8');
    expect(src).toMatch(/priceIsMostlyFees\(\{ venue: 'stripe'/);
  });
  it('readiness, for every kind of plan, says so before the owner can allow it', () => {
    const src = readFileSync('src/services/venture/hand.ts', 'utf8');
    const ready = /export async function readiness[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect((ready.match(/feeFloorOf\(plan\)/g) ?? []).length).toBe(3);
  });
  it('the door refuses to mint a link the floor refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const { createPaymentLinkHandler } = await import('../../src/services/integration/stripe-gateway.js') as unknown as { createPaymentLinkHandler: (r: unknown) => Promise<unknown> };
    const meta = { app: 'foundry', experiment_id: 'x' };
    const req = (unit_amount: number, custom_amount?: unknown) => ({ productId: 'p', tool: 't', action: 'a', dedupKey: 'k',
      params: { unit_amount, currency: 'usd', price_lookup_key: 'k', product_name: 'n', product_metadata: meta, link_metadata: meta, payment_intent_metadata: meta, confirmation_message: 'c', custom_amount } });
    await expect(createPaymentLinkHandler(req(100))).rejects.toThrow(/fifth/);
    await expect(createPaymentLinkHandler(req(1200, { minimum: 100, maximum: 10_000, preset: 1200 }))).rejects.toThrow(/fifth/);
    vi.unstubAllGlobals();
  });
});
