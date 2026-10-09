// =============================================================================
// EVERY WAY TO PAY IS A WAY TO BE DELIVERED (F1, 9 October 2026).
//
// AcreOS had a checkout path that took payment while its webhook ignored the
// kind of payment it made: charged, nothing delivered. Foundry takes money in
// exactly one way — a Stripe payment link per test, made by the
// `stripe_create_payment_link` tool from `paymentLinkParams` — and gives it
// back in one: `stripe_create_refund`. This holds both to the intake:
//   * THE POPULATION OF MONEY TOOLS is every `stripe_*` tool registered at the
//     outbound door, each classified; a new one that is not fails here;
//   * EVERY KIND OF LINK the params can make (a fixed price, a price the buyer
//     chooses, a weekly subscription) is paid with the event Stripe sends for
//     it, built from the link's OWN tags, and the intake reads exactly one
//     payment for the right test from it — so a link that stopped tagging what
//     it sells, or a new kind the intake does not read, turns this red;
//   * a refund is read as one refund of that payment.
// That a payment through the REAL route, replayed, is one delivery is proved
// for the one-time sale by `a-printable-reaches-a-buyer` (three replays, one
// fulfilment, one email) and `stripe-replays-mid-campaign` (five replays); that
// the route is reachable and refuses a bad signature, by
// `every-inbound-door-is-reachable-and-signed`.
// =============================================================================
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paymentLinkParams, type OfferPrice } from '../../src/services/venture/payment-link.js';
import { settlementFactsFromStripeEvent } from '../../src/services/venture/settlement-intake.js';

const EXP = 'exp_pay';
const base: OfferPrice = { amountCents: 900, currency: 'usd', lookupKey: 'k', productName: 'P', productMetadata: { plan_key: 'p' }, confirmationMessage: 'thanks' };
const SHAPES: Record<string, OfferPrice> = {
  'a fixed price': base,
  'a price the buyer chooses': { ...base, chosen: { minimumCents: 300, maximumCents: 5000 } },
  'a weekly subscription': { ...base, recurring: { interval: 'week' } },
};

/** The event Stripe sends when a buyer pays through a link made with these params, tagged only as the params tag it. */
function paidEventFor(p: Record<string, unknown>): { type: string; data: { object: Record<string, unknown> } } {
  const primitive = (p.link_metadata as Record<string, string>).primitive;
  if (primitive === 'sale') {
    return { type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', object: 'payment_intent', amount: 900, amount_received: 900, currency: 'usd',
      latest_charge: 'ch_1', receipt_email: 'b@example.com', metadata: p.payment_intent_metadata ?? {} } } };
  }
  if (primitive === 'subscription') {
    return { type: 'invoice.paid', data: { object: { id: 'in_1', object: 'invoice', amount_paid: 900, currency: 'usd', charge: 'ch_1', customer_email: 'b@example.com',
      parent: { subscription_details: { subscription: 'sub_1', metadata: p.subscription_metadata ?? {} } } } } };
  }
  throw new Error(`a link of kind "${String(primitive)}" has no paid event this intake is known to read: charged, nothing delivered`);
}

describe('the money tools at the door', () => {
  it('every stripe tool registered is classified, and only one takes money in', () => {
    const src = readFileSync('src/services/integration/stripe-gateway.ts', 'utf8');
    const tools = [...src.matchAll(/registerToolHandler\('(stripe_[a-z_]+)'/g)].map((m) => m[1]).sort();
    const CLASSIFIED: Record<string, 'takes money in' | 'gives money back' | 'changes or stops a way to pay'> = {
      stripe_create_payment_link: 'takes money in',
      stripe_create_refund: 'gives money back',
      stripe_deactivate_payment_link: 'changes or stops a way to pay',
      stripe_update_subscription: 'changes or stops a way to pay',
    };
    expect(tools.length).toBeGreaterThanOrEqual(4);
    expect(tools).toEqual(Object.keys(CLASSIFIED).sort());
  });
});

describe('every kind of link, paid, is read as one payment for its test', () => {
  for (const [name, price] of Object.entries(SHAPES)) {
    it(name, () => {
      const params = paymentLinkParams(EXP, price);
      const facts = settlementFactsFromStripeEvent({ id: 'evt_1', ...paidEventFor(params) });
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ kind: 'payment', experimentId: EXP, amountCents: 900 });
    });
  }
  it('a kind the intake does not read fails, rather than charging for nothing', () => {
    expect(() => paidEventFor({ link_metadata: { primitive: 'tip' } })).toThrow(/charged, nothing delivered/);
  });
  it('a refund of a sale is read as one refund of that payment', () => {
    const meta = paymentLinkParams(EXP, base).payment_intent_metadata as Record<string, string>;
    const facts = settlementFactsFromStripeEvent({ id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', currency: 'usd',
      amount_refunded: 900, metadata: meta, refunds: { data: [{ id: 're_1', amount: 900 }] } } } });
    expect(facts).toEqual([expect.objectContaining({ kind: 'refund', paymentRef: 'pi_1', amountCents: 900, experimentId: EXP })]);
  });
});
