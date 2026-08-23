process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A WEBHOOK FOR A COMPANY THAT IS NOT THERE.
//
// `POST /webhooks/stripe/:productId` passed the id straight from the URL into
// the processing chain. RT02-09 is about the signature proving the event came
// from Stripe and not which company it belongs to; the replay half is closed
// one layer down, because the event id is globally unique in `stripe_events`.
//
// What was missing here is smaller and entirely checkable: an id belonging to
// no company — a typo, a deleted company, a paused one, a company on its way
// out under a scheduled erasure — ran the whole chain, wrote rows against it,
// and got a success body back. A company that is not operating does not receive
// revenue events.
//
// WHAT IS STILL NOT PROVEN: one webhook secret serves every tenant. Binding an
// event to a company needs the company's own Stripe account id on the product
// row and a per-account secret — a connect-flow change that cannot be verified
// against real Stripe from here, and the route says so where it is read.
// =============================================================================

const SRC = stripComments(readFileSync('src/index.ts', 'utf8'), { lineComments: true });
const route = SRC.slice(SRC.indexOf("app.post('/webhooks/stripe/:productId'"));

describe('the per-product Stripe webhook', () => {
  it('asks whether the company exists and is operating', () => {
    // Comments stripped: the paragraph above the check quotes the defect.
    expect(route.slice(0, 1400)).toContain('operatingProduct()');
    expect(route.slice(0, 1400)).toContain("FROM products WHERE id = ?");
  });

  it('asks before it processes, not after', () => {
    const check = route.indexOf('operatingProduct()');
    const process = route.indexOf('processStripeEventChain');
    expect(check).toBeGreaterThan(-1);
    expect(process).toBeGreaterThan(check);
  });

  it('answers 404 rather than a success body', () => {
    expect(route.slice(0, 1600)).toContain("{ error: 'Unknown product' }, 404");
  });

  it('still verifies the signature first', () => {
    const verify = route.indexOf('verifyStripeWebhook');
    const check = route.indexOf('operatingProduct()');
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(check);
  });
});
