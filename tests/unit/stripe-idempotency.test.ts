// =============================================================================
// Tests: Stripe money idempotency (Roadmap 3.4)
//
// Every mutating Stripe call is wrapped in withRetry(). Without an idempotency
// key, a retry that fires after the original request already succeeded creates a
// duplicate customer/subscription — a double-charge. These tests assert each
// wrapper passes a Stripe-native idempotencyKey, that the SAME key is reused
// across a call's retries (so the retry dedups server-side), and that distinct
// logical calls get distinct keys (no cross-call collision).
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = {
  customerCreate: [] as unknown[][],
  subCreate: [] as unknown[][],
  subUpdate: [] as unknown[][],
  subCancel: [] as unknown[][],
  checkoutCreate: [] as unknown[][],
  portalCreate: [] as unknown[][],
};
// When set, customers.create rejects on its first invocation for this email
// (simulating a lost-response network blip) and succeeds on the retry.
let flakyEmail: string | null = null;
const flakyState: Record<string, number> = {};

vi.mock('stripe', () => ({
  default: class {
    customers = {
      create: (params: { email?: string }, ...rest: unknown[]) => {
        calls.customerCreate.push([params, ...rest]);
        if (flakyEmail && params.email === flakyEmail) {
          flakyState[params.email] = (flakyState[params.email] ?? 0) + 1;
          if (flakyState[params.email] === 1) return Promise.reject(new Error('network blip'));
        }
        return Promise.resolve({ id: 'cus_1' });
      },
    };
    subscriptions = {
      create: (...a: unknown[]) => { calls.subCreate.push(a); return Promise.resolve({ id: 'sub_1' }); },
      update: (...a: unknown[]) => { calls.subUpdate.push(a); return Promise.resolve({ id: 'sub_1' }); },
      cancel: (...a: unknown[]) => { calls.subCancel.push(a); return Promise.resolve({ id: 'sub_1' }); },
    };
    checkout = { sessions: { create: (...a: unknown[]) => { calls.checkoutCreate.push(a); return Promise.resolve({ url: 'https://pay' }); } } };
    billingPortal = { sessions: { create: (...a: unknown[]) => { calls.portalCreate.push(a); return Promise.resolve({ url: 'https://portal' }); } } };
  },
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_SOLO_PRICE_ID = 'price_solo';
process.env.STRIPE_GROWTH_PRICE_ID = 'price_growth';
process.env.STRIPE_INVESTOR_READY_PRICE_ID = 'price_ir';

// The RequestOptions object is always the LAST argument to each Stripe method.
const key = (args: unknown[]): string | undefined =>
  (args[args.length - 1] as Record<string, unknown> | undefined)?.idempotencyKey as string | undefined;

beforeEach(() => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = [];
  flakyEmail = null;
  for (const k of Object.keys(flakyState)) delete flakyState[k];
});

describe('Stripe money idempotency', () => {
  it('passes an idempotencyKey on every mutating call', async () => {
    const billing = await import('../../src/services/billing/stripe.js');
    await billing.createCustomer('a@b.co', 'A');
    await billing.createSubscription('cus_1', 'solo');
    await billing.createCheckoutSession('cus_1', 'growth', 's', 'c');
    await billing.createBillingPortalSession('cus_1', 'https://foundry.test/settings');
    await billing.pauseSubscription('sub_1');
    await billing.cancelSubscription('sub_1');

    expect(key(calls.customerCreate[0])).toBeTruthy();
    expect(key(calls.subCreate[0])).toBeTruthy();
    expect(key(calls.checkoutCreate[0])).toBeTruthy();
    expect(key(calls.portalCreate[0])).toBeTruthy();
    expect(key(calls.subUpdate[0])).toBeTruthy();
    expect(key(calls.subCancel[0])).toBeTruthy();
  });

  it('reuses the SAME key across retries of one logical call (retry dedups)', async () => {
    const billing = await import('../../src/services/billing/stripe.js');
    flakyEmail = 'retry@b.co';
    await billing.createCustomer('retry@b.co', null);
    // First attempt threw → withRetry retried → two invocations, one key.
    expect(calls.customerCreate.length).toBe(2);
    expect(key(calls.customerCreate[0])).toBe(key(calls.customerCreate[1]));
    expect(key(calls.customerCreate[0])).toBeTruthy();
  });

  it('mints a DIFFERENT key per distinct logical call (no cross-call collision)', async () => {
    const billing = await import('../../src/services/billing/stripe.js');
    await billing.createCustomer('one@b.co', null);
    await billing.createCustomer('two@b.co', null);
    expect(key(calls.customerCreate[0])).not.toBe(key(calls.customerCreate[1]));
  });
});
