// The brief and the offer text live as Markdown under river/proof-1 for people
// to read and are embedded for the seed to run where only dist/ exists. Two
// copies of a promise drift; this refuses the drift.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRIEF_MD, OUTREACH_TEMPLATE_MD } from '../../src/services/venture/proof-1-content.js';
import { PROOF1_PLAN, PROOF1_RECIPIENTS } from '../../src/services/venture/proof-1.js';
import { checkDeliverableQuality, checkOfferQuality } from '../../src/services/venture/hand.js';

describe('the Proof 1 seed carries the files it says it does', () => {
  it('embeds river/proof-1/brief.md and outreach-template.md verbatim', () => {
    expect(BRIEF_MD).toBe(readFileSync('river/proof-1/brief.md', 'utf8'));
    expect(OUTREACH_TEMPLATE_MD).toBe(readFileSync('river/proof-1/outreach-template.md', 'utf8'));
  });
  it('would pass its own quality gates on the day after the pull, and names every participant once', () => {
    const now = new Date('2026-09-08T00:00:00Z');
    expect(checkDeliverableQuality({ id: 'x', kind: 'deliverable', title: 'brief', body: BRIEF_MD, pulledAt: '2026-09-07T12:00:00.000Z', digest: 'd', paymentLinkUrl: null, recordedAt: '' }, now)).toEqual({ ok: true, failures: [] });
    // The template names the Workshop's page. Filled either way it passes: with
    // a page (the message points there and the payment path is on it), and
    // without one (the link takes the page's place, as `fillOffer` does).
    const filled = (to: string) => ({ id: 'y', kind: 'offer' as const, title: PROOF1_PLAN.offerSubject, body: OUTREACH_TEMPLATE_MD.replace('[APEX MICRO EXPERIMENT PAGE]', to), pulledAt: null, digest: 'd', paymentLinkUrl: 'https://buy.stripe.com/test_x', recordedAt: '' });
    const page = 'https://apexmicro.ai/experiments/ma-millwork-bid-brief';
    expect(checkOfferQuality(filled(page), page)).toEqual({ ok: true, failures: [] });
    expect(checkOfferQuality(filled('https://buy.stripe.com/test_x'), null)).toEqual({ ok: true, failures: [] });
    // And a message that points nowhere the buyer can act is refused.
    expect(checkOfferQuality(filled(page), null).ok).toBe(false);
    expect(new Set(PROOF1_RECIPIENTS.map((r) => r.counterpartyRef)).size).toBe(PROOF1_RECIPIENTS.length);
    expect(PROOF1_RECIPIENTS.filter((r) => r.channel === 'email').every((r) => r.email?.includes('@'))).toBe(true);
    expect(PROOF1_PLAN.price).toMatchObject({ amountCents: 2900, currency: 'USD' });
  });
});
