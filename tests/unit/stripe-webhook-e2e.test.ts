// =============================================================================
// Tests: Stripe billing webhook — end-to-end against the REAL handler (3.4 / §2)
//
// The full "hosted checkout → tier flips" journey has two halves:
//   1. Stripe's hosted checkout page + card capture  — needs a deployed app +
//      a browser; can only be run on staging (GO-LIVE-CHECKLIST §2).
//   2. Our webhook handler turning Stripe's events into tier/trial/scp state —
//      pure logic over the event + our DB, and THE part most likely to carry a
//      bug (it's where the tier-CHECK drift lived).
//
// This test exercises half 2 at full fidelity: it signs real Stripe event
// payloads with Stripe's own signer and drives the actual handleWebhook() over
// real migrations, then asserts the founder's tier/trial/funnel/scp state — the
// exact transitions a real trial→active→cancel checkout produces.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.STRIPE_SOLO_PRICE_ID = 'price_solo_test';
process.env.STRIPE_GROWTH_PRICE_ID = 'price_growth_test';
process.env.STRIPE_INVESTOR_READY_PRICE_ID = 'price_ir_test';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import Stripe from 'stripe';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { handleWebhook } from '../../src/services/billing/stripe.js';

const stripe = new Stripe('sk_test_fake', { apiVersion: '2023-10-16' });
const CUSTOMER = 'cus_test_founder';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

// Build a signed (payload, signature) pair exactly as Stripe delivers it, using
// Stripe's own HMAC signer — so constructEvent() inside handleWebhook accepts it.
function signedEvent(id: string, type: string, object: Record<string, unknown>): [string, string] {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return [payload, signature];
}

function subscription(opts: { status: string; priceId: string; trialEnd?: number | null }): Record<string, unknown> {
  return {
    id: 'sub_test_1',
    object: 'subscription',
    customer: CUSTOMER,
    status: opts.status,
    trial_end: opts.trialEnd ?? null,
    items: { object: 'list', data: [{ id: 'si_1', price: { id: opts.priceId } }] },
  };
}

beforeAll(async () => {
  await runMigrations();
  // A founder mid-checkout: customer created + stored, no tier yet (exactly the
  // state settings.ts leaves before redirecting to Stripe).
  await query(
    "INSERT INTO founders (id, clerk_user_id, email, stripe_customer_id) VALUES ('f_e2e','clk_e2e','e2e@foundry.so',?)",
    [CUSTOMER],
  );
  await query(
    "INSERT INTO products (id, name, owner_id, scp_status) VALUES ('p_e2e','E2E App','f_e2e','active')",
    [],
  );
});

async function founder(): Promise<Record<string, unknown>> {
  const r = await query("SELECT tier, trial_ends_at FROM founders WHERE id = 'f_e2e'", []);
  return r.rows[0] as Record<string, unknown>;
}

// The funnel write is intentionally fire-and-forget (void async IIFE, non-fatal)
// so it may land a tick after handleWebhook resolves. Poll briefly for it.
async function funnelHasStep(step: string, timeoutMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await query("SELECT step FROM funnel_events WHERE founder_id = 'f_e2e'", []);
    if (r.rows.some((row) => (row as Record<string, string>).step === step)) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

describe('Stripe billing webhook — real handler, real DB', () => {
  it('trial start: subscription.created(trialing) → tier=solo, trial window set, funnel trial_started', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 14 * 86_400;
    const [payload, sig] = signedEvent('evt_created', 'customer.subscription.created',
      subscription({ status: 'trialing', priceId: 'price_solo_test', trialEnd }));
    await handleWebhook(payload, sig);

    const f = await founder();
    expect(f.tier).toBe('solo');
    expect(f.trial_ends_at).toBeTruthy(); // trial window persisted for the badge/gate
    expect(await funnelHasStep('trial_started')).toBe(true);
  });

  it('conversion: subscription.updated(active) → tier stays, trial cleared, funnel paid', async () => {
    const [payload, sig] = signedEvent('evt_active', 'customer.subscription.updated',
      subscription({ status: 'active', priceId: 'price_solo_test', trialEnd: null }));
    await handleWebhook(payload, sig);

    const f = await founder();
    expect(f.tier).toBe('solo');
    expect(f.trial_ends_at).toBeNull(); // converted → no active trial window
    expect(await funnelHasStep('paid')).toBe(true);
  });

  it('upgrade: subscription.updated(active, growth price) → tier=growth', async () => {
    const [payload, sig] = signedEvent('evt_upgrade', 'customer.subscription.updated',
      subscription({ status: 'active', priceId: 'price_growth_test', trialEnd: null }));
    await handleWebhook(payload, sig);
    expect((await founder()).tier).toBe('growth');
  });

  it('idempotency: replaying a processed event id is a no-op', async () => {
    // Re-send evt_upgrade but with a DIFFERENT tier price; the dedup guard must
    // skip it, leaving tier as growth (proving the event was not reprocessed).
    const [payload, sig] = signedEvent('evt_upgrade', 'customer.subscription.updated',
      subscription({ status: 'active', priceId: 'price_ir_test', trialEnd: null }));
    await handleWebhook(payload, sig);
    expect((await founder()).tier).toBe('growth'); // unchanged — replay ignored
  });

  it('cancel: subscription.deleted → tier cleared and the billing axis paused', async () => {
    const [payload, sig] = signedEvent('evt_deleted', 'customer.subscription.deleted',
      subscription({ status: 'canceled', priceId: 'price_growth_test', trialEnd: null }));
    await handleWebhook(payload, sig);

    const f = await founder();
    expect(f.tier).toBeNull();
    // The webhook records facts and asks the entitlement rule; the rule writes
    // the COMMERCIAL axis. `scp_status` belongs to the founder and the
    // operator, and a billing event has no business writing over it.
    const prod = await query(
      "SELECT scp_status, entitlement_paused_at FROM products WHERE id = 'p_e2e'", []);
    const row = prod.rows[0] as Record<string, string | null>;
    expect(row.entitlement_paused_at).not.toBeNull();
    expect(row.scp_status).not.toBe('paused');
  });

  it('foreign event: a subscription on an AcreOS/land price is a harmless no-op', async () => {
    // Re-tier the founder so we can prove a foreign price does NOT change it.
    await query("UPDATE founders SET tier = 'growth' WHERE id = 'f_e2e'", []);
    const [payload, sig] = signedEvent('evt_foreign', 'customer.subscription.updated',
      subscription({ status: 'active', priceId: 'price_acreos_scale', trialEnd: null }));
    await handleWebhook(payload, sig); // must not throw
    expect((await founder()).tier).toBe('growth'); // unrecognised price → untouched
  });
});
