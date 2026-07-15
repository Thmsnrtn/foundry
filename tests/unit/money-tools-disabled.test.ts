// =============================================================================
// Tests: Clean-hands default (liability audit 2026-07-14)
// Foundry does not move a user's customers' money unless FOUNDRY_ENABLE_MONEY_TOOLS
// is explicitly 'true'. The refund/subscription handlers refuse by default —
// latent liability neutered at the transport, not just the autopilot path.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import { createRefundHandler, updateSubscriptionHandler } from '../../src/services/integration/stripe-gateway.js';

const req = (params: Record<string, unknown>) =>
  ({ productId: 'p', agent: 'test', tool: 't', action: 'a', params, dedupKey: 'k' }) as never;

afterEach(() => { delete process.env.FOUNDRY_ENABLE_MONEY_TOOLS; });

describe('money tools are off by default', () => {
  it('refund refuses with a clean-hands reason when the flag is unset', async () => {
    delete process.env.FOUNDRY_ENABLE_MONEY_TOOLS;
    await expect(createRefundHandler(req({ charge_id: 'ch_1', amount: 500 })))
      .rejects.toThrow(/does not move money by default/);
  });

  it('subscription change refuses when the flag is unset', async () => {
    delete process.env.FOUNDRY_ENABLE_MONEY_TOOLS;
    await expect(updateSubscriptionHandler(req({ subscription_id: 'sub_1', body: {} })))
      .rejects.toThrow(/does not move money by default/);
  });

  it('an explicit non-true value does not enable them', async () => {
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = '1'; // only the literal 'true' enables
    await expect(createRefundHandler(req({ charge_id: 'ch_1' })))
      .rejects.toThrow(/does not move money by default/);
  });

  it('when explicitly enabled AND no Stripe key, it degrades to log-only (never silently moves money in tests)', async () => {
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
    const prevKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const r = await createRefundHandler(req({ charge_id: 'ch_1', amount: 500 }));
    expect(r.status).toBe('logged'); // no key → no live API call
    if (prevKey) process.env.STRIPE_SECRET_KEY = prevKey;
  });
});
