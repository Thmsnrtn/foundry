// =============================================================================
// Tests: the Stripe webhook, end to end against the REAL handler.
//
// Until Private S7b1 (29 September 2026) this file drove Foundry's own
// subscription billing through the webhook: trial started, converted, upgraded,
// cancelled. Foundry has no customers now — it is the owner's alone — so that
// branch was deleted and the handler moved to `services/venture/stripe-webhook.ts`
// with only the half that reports an experiment's sale.
//
// What this file now holds, with real signed payloads over real migrations:
//   - a subscription event reaches the handler and changes NOBODY's tier or
//     trial — the branch that used to act on it is gone, not merely skipped;
//   - the claim-per-event-id idempotency still holds;
//   - a payload that is not signed with the secret is refused before anything
//     is written.
// The sale half is proven by the venture tests (the-first-real-experiment-runs-
// by-hand, the-workshop-has-one-public-face, 10-thirty-days-of-a-portfolio).
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import Stripe from 'stripe';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { handleWebhook } from '../../src/services/venture/stripe-webhook.js';

const stripe = new Stripe('sk_test_fake', { apiVersion: '2023-10-16' });
const CUSTOMER = 'cus_test_founder';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

function signedEvent(id: string, type: string, object: Record<string, unknown>, secret = SECRET): [string, string] {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return [payload, signature];
}

function subscription(status: string): Record<string, unknown> {
  return {
    id: 'sub_test_1', object: 'subscription', customer: CUSTOMER, status,
    trial_end: Math.floor(Date.now() / 1000) + 14 * 86_400,
    items: { object: 'list', data: [{ id: 'si_1', price: { id: 'price_solo_test', metadata: { plan_key: 'solo' } } }] },
  };
}

const claims = async (id: string): Promise<number> =>
  Number(((await query('SELECT COUNT(*) AS n FROM stripe_webhook_events WHERE event_id = ?', [id]))
    .rows[0] as Record<string, unknown>).n);

beforeAll(async () => {
  await runMigrations();
  await query(
    "INSERT INTO founders (id, clerk_user_id, email, stripe_customer_id) VALUES ('f_e2e','clk_e2e','e2e@foundry.example',?)",
    [CUSTOMER]);
  await query("INSERT INTO products (id, name, owner_id, scp_status) VALUES ('p_e2e','E2E App','f_e2e','active')", []);
});

describe('the Stripe webhook after the subscription branch was deleted', () => {
  it('lives with the experiments, and the billing file is gone', () => {
    expect(existsSync('src/services/venture/stripe-webhook.ts')).toBe(true);
    expect(existsSync('src/services/billing/stripe.ts')).toBe(false);
  });

  it('receives a subscription event and gives nobody a tier or a trial', async () => {
    const [payload, sig] = signedEvent('evt_created', 'customer.subscription.created', subscription('trialing'));
    await handleWebhook(payload, sig);
    const f = (await query("SELECT tier, trial_ends_at, paid_through FROM founders WHERE id = 'f_e2e'", []))
      .rows[0] as Record<string, unknown>;
    expect(f).toMatchObject({ tier: null, trial_ends_at: null, paid_through: null });
    expect(await claims('evt_created'), 'the event was received and claimed').toBe(1);
  });

  it('pauses nothing on a cancellation', async () => {
    const [payload, sig] = signedEvent('evt_deleted', 'customer.subscription.deleted', subscription('canceled'));
    await handleWebhook(payload, sig);
    const p = (await query("SELECT scp_status, entitlement_paused_at FROM products WHERE id = 'p_e2e'", []))
      .rows[0] as Record<string, unknown>;
    expect(p).toMatchObject({ scp_status: 'active', entitlement_paused_at: null });
  });

  it('claims each event id once, so a replay is a no-op', async () => {
    const [payload, sig] = signedEvent('evt_created', 'customer.subscription.created', subscription('active'));
    await handleWebhook(payload, sig);
    expect(await claims('evt_created')).toBe(1);
  });

  it('refuses a payload not signed with the secret, and writes nothing', async () => {
    const [payload, sig] = signedEvent('evt_forged', 'customer.subscription.created', subscription('active'), 'whsec_wrong');
    await expect(handleWebhook(payload, sig)).rejects.toThrow();
    expect(await claims('evt_forged')).toBe(0);
  });
});
