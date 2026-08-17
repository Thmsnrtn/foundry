// =============================================================================
// Tests: cancelling ends the plan, not the period already paid for
//
// The owner's instruction was to follow the ordinary SaaS convention: a founder
// who cancels keeps the service through the period they have already been
// charged for, like every subscription product does.
//
// Foundry did the opposite in two places at once:
//
//   `cancelSubscription` called `stripe.subscriptions.cancel()` — immediate
//   termination, no refund of the remainder.
//
//   `customer.subscription.deleted` nulled the tier and ran
//   `UPDATE products SET scp_status='paused'` inline, so the moment the event
//   arrived the agents stopped, whatever the customer had paid for.
//
// The second was the more interesting defect: the webhook was gathering facts
// AND ruling on them, which made it a second implementation of the entitlement
// rule — and the one that ran first. It now records what Stripe said and asks
// `applyEntitlementForFounder`, the same function the hourly sweep calls.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { entitledToAct } from '../../src/services/billing/entitlement.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const future = '2026-07-01T00:00:00Z';
const past = '2026-06-01T00:00:00Z';

describe('entitlement after a cancellation', () => {
  it('keeps a cancelled founder entitled until the period they paid for ends', () => {
    // tier is gone — the plan ended. paid_through is the period they bought.
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: future }, NOW)).toBe(true);
  });

  it('stops when that period is over', () => {
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: past }, NOW)).toBe(false);
  });

  it('is unmoved by a paid-through date on an account that never paid', () => {
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: null }, NOW)).toBe(false);
    expect(entitledToAct({ tier: null, trialEndsAt: null }, NOW)).toBe(false);
  });

  it('treats an unparseable paid-through as no entitlement, not free service', () => {
    // Returning true on a corrupt value would be service nothing ever reclaims,
    // and nothing would ever notice it had been granted.
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: 'soon' }, NOW)).toBe(false);
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: '' }, NOW)).toBe(false);
  });

  it('still honours a plan and a live trial', () => {
    expect(entitledToAct({ tier: 'solo', trialEndsAt: past, paidThrough: past }, NOW)).toBe(true);
    expect(entitledToAct({ tier: null, trialEndsAt: future, paidThrough: null }, NOW)).toBe(true);
  });

  it('gives dunning the right shape without a second mechanism', () => {
    // A past-due account: Stripe has already advanced the period end and is
    // retrying the invoice. Access continues through the retry window, and
    // stops if the retries are exhausted and the period lapses.
    expect(entitledToAct({ tier: null, trialEndsAt: null, paidThrough: future }, NOW)).toBe(true);
  });
});

describe('the code that cancels', () => {
  // Comments stripped: this file explains the old call in prose, and a gate
  // that counts its own explanation as a violation is a gate nobody trusts.
  const source = readFileSync(
    resolve(__dirname, '../../src/services/billing/stripe.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  it('asks Stripe to end the subscription at the period end', () => {
    expect(source).toMatch(/cancel_at_period_end:\s*true/);
  });

  it('does not terminate the subscription immediately', () => {
    expect(source, 'subscriptions.cancel() forfeits the rest of a paid period')
      .not.toMatch(/subscriptions\.cancel\(/);
  });
});

describe('the deletion webhook', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/services/billing/stripe.ts'), 'utf8');
  const branch = source.slice(source.indexOf("case 'customer.subscription.deleted'"));
  const body = branch.slice(0, branch.indexOf('break;'));

  it('records the paid-through period rather than discarding it', () => {
    expect(body).toMatch(/paid_through = COALESCE/);
  });

  it('does not decide the pause itself', () => {
    expect(body, 'a webhook that both gathers facts and rules on them is a second rule')
      .not.toMatch(/UPDATE products SET scp_status/);
  });

  it('asks the one entitlement rule instead', () => {
    expect(body).toMatch(/applyEntitlementForFounder/);
  });

  it('pauses agent instances only for products that actually paused', () => {
    expect(body).toMatch(/for \(const productId of paused\)/);
  });
});
