process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { describe, expect, it } from 'vitest';

// =============================================================================
// THE GOVERNED STRIPE DOOR IS OPEN.
//
// A direct call to Stripe with the account credential worked perfectly for the
// entire duration of the outage. It proved the credential and nothing else.
// What was broken was Foundry's OWN path: integration/stripe-gateway.ts
// registers its tool handlers as a side effect of being imported, nothing
// imported it, and so every governed call came back "no trusted policy
// registered for tool 'stripe_create_payment_link'".
//
// PROVIDER REACHABILITY IS NOT INSTITUTIONAL REACHABILITY. These tests only
// ever ask the institution's own registry, and they load it the way the
// production path loads it — by importing the module Experiment 001 actually
// calls, not the gateway directly.
// =============================================================================

describe('importing what Experiment 001 imports registers the Stripe tools', () => {
  it('registers stripe_create_payment_link through the production import path', async () => {
    // payment-link.ts is what the hand calls. If IT does not pull the gateway
    // in, the door is shut no matter how healthy the credential is.
    await import('../../src/services/venture/payment-link.js');
    const { toolIsRegistered } = await import('../../src/services/outbound/gateway.js');
    expect(toolIsRegistered('stripe_create_payment_link'),
      'the governed door Experiment 001 needs is not registered').toBe(true);
  });

  it('registers every Stripe tool the experiment lifecycle depends on', async () => {
    await import('../../src/services/venture/payment-link.js');
    const { toolIsRegistered } = await import('../../src/services/outbound/gateway.js');
    for (const tool of [
      'stripe_create_payment_link',      // placing the offer
      'stripe_deactivate_payment_link',  // taking it down when the test ends
      'stripe_create_refund',            // refunding a delivery that failed
    ]) {
      expect(toolIsRegistered(tool), `${tool} is not registered`).toBe(true);
    }
  });

  it('still refuses a tool nobody registered, so the check is not vacuous', async () => {
    await import('../../src/services/venture/payment-link.js');
    const { toolIsRegistered } = await import('../../src/services/outbound/gateway.js');
    expect(toolIsRegistered('stripe_invent_money')).toBe(false);
  });
});
