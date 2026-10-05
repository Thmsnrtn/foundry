// =============================================================================
// LAW (Roadmap 2027 R29, the other half): THE STORED OFFER TEXT IS TRUE.
//
// The offer text every brief carried said "It's $X, one-time. No
// subscription." whatever the plan was, and the gate that checks it required
// exactly those words: a weekly brief's offer read as a one-time purchase, a
// pay-what-it-was-worth offer stated a fixed price, and a truthful weekly text
// would have been refused. The text is now written from the plan, and the
// gate reads it against the plan: the price it states, and for a weekly offer
// the three sentences the public page already must carry.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
import { describe, expect, it } from 'vitest';
import { renderOfferTemplate } from '../../src/services/venture/products/registry.js';
import { checkOfferQuality } from '../../src/services/venture/hand.js';

const base = {
  shape: { sells: 'a dated shortlist of public bid notices.', claimsMade: 'a shortlist', collects: 'an email', deliversBy: 'email', sellsTo: 'Small contractors.', chargesHow: 'x' },
  lighter: 'x', facts: {},
  price: { amountCents: 1200, currency: 'USD', lookupKey: 'k', productName: 'p', productMetadata: {}, confirmationMessage: 'c' },
};
const material = (body: string) => ({ id: 'm', kind: 'offer_template', title: 't', body: body.replace('[APEX MICRO EXPERIMENT PAGE]', 'https://apexmicro.ai/experiments/bids'),
  pulledAt: null, digest: '', paymentLinkUrl: 'https://buy.stripe.com/test_1', recordedAt: '' });
const PAGE = 'https://apexmicro.ai/experiments/bids';

describe('the text says what the plan sells', () => {
  it('one-time: the price, once, and no subscription', () => {
    const t = renderOfferTemplate(base as never, 'Apex Micro', 'Massachusetts');
    expect(t).toContain("It's $12, one-time. No subscription.");
    expect(checkOfferQuality(material(t) as never, PAGE, base as never)).toEqual({ ok: true, failures: [] });
  });
  it('weekly: charged every week until cancelled, how to cancel, and nothing after', () => {
    const weekly = { ...base, price: { ...base.price, amountCents: 500, recurring: { interval: 'week' } } };
    const t = renderOfferTemplate(weekly as never, 'Apex Micro', 'Massachusetts');
    expect(t).toContain('$5 a week until you cancel');
    expect(t).toContain('cancel any time from the link in every email');
    expect(t).toContain('nothing is charged after you cancel');
    expect(t).not.toMatch(/one-time|no subscription/i);
    expect(checkOfferQuality(material(t) as never, PAGE, weekly as never)).toEqual({ ok: true, failures: [] });
  });
  it('chosen: what it was worth, the suggestion, and no subscription', () => {
    const chosen = { ...base, price: { ...base.price, chosen: { minimumCents: 300, maximumCents: 10_000 } } };
    const t = renderOfferTemplate(chosen as never, 'Apex Micro', 'Massachusetts');
    expect(t).toContain('pay what it was worth to you, $12 suggested');
    expect(checkOfferQuality(material(t) as never, PAGE, chosen as never)).toEqual({ ok: true, failures: [] });
  });
});

describe('the gate reads the text against the plan', () => {
  it('refuses a one-time text for a weekly plan, and a price the plan does not charge', () => {
    const weekly = { ...base, price: { ...base.price, amountCents: 500, recurring: { interval: 'week' } } };
    const oneTimeText = renderOfferTemplate(base as never, 'Apex Micro', 'Massachusetts');
    const q = checkOfferQuality(material(oneTimeText) as never, PAGE, weekly as never);
    expect(q.ok).toBe(false);
    expect(q.failures.join(' | ')).toMatch(/charged every week until cancelled/);
    expect(q.failures.join(' | ')).toMatch(/does not state the price the plan charges \(\$5\)/);
  });
  it('without a plan to read against, the old rule stands', () => {
    const t = renderOfferTemplate(base as never, 'Apex Micro', 'Massachusetts');
    expect(checkOfferQuality(material(t) as never, PAGE).ok).toBe(true);
  });
});
