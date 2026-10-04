// =============================================================================
// THE MONEY DOOR MOVES ONLY FOUNDRY'S MONEY (Roadmap 2027 R21).
//
// The Stripe account is shared: the owner's land sales and another app's
// subscriptions sit beside Foundry's tests, and a restricted key limits by
// resource, never by whose sale it was. Before Foundry's money switch may be
// turned on, the door and the handler must each refuse what is not exactly a
// Foundry purchase's own refund or its own stop:
//
//   the handler reads the charge and refunds only one Foundry tagged, never
//   more than is left on it; a week of a subscription is refunded only when
//   the invoice is a Foundry subscription's and its payment is that charge;
//   an intent stands for a charge only when it is an intent; a subscription
//   is changed only to end at its paid period, and only if Foundry started it
//   → the door finds the refund act only for the refund that purchase allows,
//   built from its own row, whatever key the caller presents → a buyer's ask
//   through the signed link is recorded before anything can refuse it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, advanceDays, runMorning, seedProductionShape } from '../helpers/world.js';

type Stub = Record<string, unknown>;
const posts: Array<{ url: string; body: string }> = [];
const handlerFetch = (routes: Record<string, Stub>) => vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const path = String(url).replace('https://api.stripe.com/v1', '');
  if ((init?.method ?? 'GET') === 'POST') { posts.push({ url: path, body: String(init?.body ?? '') }); return new Response(JSON.stringify({ id: 're_1', status: 'succeeded', amount: 1 }), { status: 200 }); }
  const hit = Object.keys(routes).find((k) => path === k || path.startsWith(`${k}?`));
  return hit ? new Response(JSON.stringify(routes[hit]), { status: 200 }) : new Response('{}', { status: 404 });
});
const FOUNDRY = { app: 'foundry', experiment_id: 'exp_1' };
const LAND = { app: 'acreos', parcel: 'lot_7' };

describe('the handler reads the money before it moves it', () => {
  afterEach(() => { vi.unstubAllGlobals(); posts.length = 0; });
  let handlers: typeof import('../../src/services/integration/stripe-gateway.js');
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_door';
    handlers = await import('../../src/services/integration/stripe-gateway.js');
  });
  const refund = (params: Record<string, unknown>) => handlers.createRefundHandler({ productId: 'p', tool: 'stripe_create_refund', action: 'a', dedupKey: 'k', params } as never);
  const stop = (params: Record<string, unknown>) => handlers.updateSubscriptionHandler({ productId: 'p', tool: 'stripe_update_subscription', action: 'a', dedupKey: 'k', params } as never);

  it('refunds a charge Foundry tagged, the whole of what is left', async () => {
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_ok': { id: 'ch_ok', amount: 2900, amount_refunded: 0, metadata: FOUNDRY } }));
    await refund({ charge_id: 'ch_ok', amount: 2900, reason: 'requested_by_customer' });
    expect(posts).toHaveLength(1);
    const body = new URLSearchParams(posts[0]!.body);
    expect(body.get('charge')).toBe('ch_ok');
    expect(body.get('amount')).toBe('2900');
  });

  it('refuses a land sale on the same account, however it was asked for', async () => {
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_land': { id: 'ch_land', amount: 4_500_000, amount_refunded: 0, metadata: LAND } }));
    await expect(refund({ charge_id: 'ch_land', amount: 2900 })).rejects.toThrow(/not a sale Foundry tagged/);
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_bare': { id: 'ch_bare', amount: 2900, amount_refunded: 0, metadata: {} } }));
    await expect(refund({ charge_id: 'ch_bare', amount: 2900 })).rejects.toThrow(/not a sale Foundry tagged/);
    expect(posts).toHaveLength(0);
  });

  it('refuses more than is left on the charge', async () => {
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_ok': { id: 'ch_ok', amount: 2900, amount_refunded: 2000, metadata: FOUNDRY } }));
    await expect(refund({ charge_id: 'ch_ok', amount: 2900 })).rejects.toThrow(/2900 cents asked, 900 left/);
    await expect(refund({ charge_id: 'ch_ok', amount: -5 })).rejects.toThrow(/left to refund/);
    expect(posts).toHaveLength(0);
  });

  it('lets an intent stand for its charge, and nothing else', async () => {
    vi.stubGlobal('fetch', handlerFetch({ '/payment_intents/pi_1': { latest_charge: 'ch_ok' }, '/charges/ch_ok': { id: 'ch_ok', amount: 2900, amount_refunded: 0, metadata: FOUNDRY } }));
    await refund({ payment_intent: 'pi_1', amount: 2900 });
    expect(new URLSearchParams(posts[0]!.body).get('charge')).toBe('ch_ok');
    await expect(refund({ payment_intent: 'in_1', amount: 2900 })).rejects.toThrow(/only a payment intent/);
  });

  it('refunds a week only when the invoice is a Foundry subscription\'s and its payment is that charge', async () => {
    const charge = { id: 'ch_week', amount: 900, amount_refunded: 0, metadata: {} };
    // Current shape: the tag under the invoice's parent, the payment listed on the invoice.
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_week': charge,
      '/invoices/in_ours': { parent: { subscription_details: { subscription: 'sub_1', metadata: FOUNDRY } }, payments: { data: [{ payment: { charge: 'ch_week' } }] } } }));
    await refund({ charge_id: 'ch_week', invoice_id: 'in_ours', amount: 900 });
    expect(posts).toHaveLength(1);
    // Another app's subscription.
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_week': charge,
      '/invoices/in_theirs': { parent: { subscription_details: { subscription: 'sub_x', metadata: { app: 'acreos' } } }, payments: { data: [{ payment: { charge: 'ch_week' } }] } },
      '/subscriptions/sub_x': { metadata: { app: 'acreos' } } }));
    await expect(refund({ charge_id: 'ch_week', invoice_id: 'in_theirs', amount: 900 })).rejects.toThrow(/subscription Foundry did not start/);
    // Our invoice, somebody else's charge.
    vi.stubGlobal('fetch', handlerFetch({ '/charges/ch_other': { ...charge, id: 'ch_other' },
      '/invoices/in_ours': { subscription: 'sub_1', subscription_details: { metadata: FOUNDRY }, charge: 'ch_week' } }));
    await expect(refund({ charge_id: 'ch_other', invoice_id: 'in_ours', amount: 900 })).rejects.toThrow(/not the payment of that invoice/);
    expect(posts).toHaveLength(1);
  });

  it('changes a subscription only to end at its paid period, and only one Foundry started', async () => {
    vi.stubGlobal('fetch', handlerFetch({ '/subscriptions/sub_1': { metadata: FOUNDRY }, '/subscriptions/sub_land': { metadata: LAND } }));
    await expect(stop({ subscription_id: 'sub_1', body: { 'items[0][price]': 'price_dearer' } })).rejects.toThrow(/only change Foundry makes/);
    await expect(stop({ subscription_id: 'sub_1', body: { cancel_at_period_end: 'true', 'items[0][price]': 'price_dearer' } })).rejects.toThrow(/only change Foundry makes/);
    await expect(stop({ subscription_id: 'sub_land', body: { cancel_at_period_end: 'true' } })).rejects.toThrow(/not one Foundry started/);
    expect(posts).toHaveLength(0);
    await stop({ subscription_id: 'sub_1', body: { cancel_at_period_end: 'true' } });
    expect(posts).toHaveLength(1);
  });
});

describe('the door finds the refund act only for the refund the purchase allows', () => {
  let X = '';
  let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;
  const PAID = 'pi_door_1';
  beforeAll(async () => {
    const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
    X = seeded.experimentId;
    providers = seeded.providers!;
    await advanceDays(1);
    await runMorning(HANDS);
    const link = providers.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!;
    providers.state.charges.set(`ch_${PAID}`, { amount: 2900, amount_refunded: 0, metadata: { app: 'foundry', experiment_id: X } });
    providers.state.charges.set('ch_land_sale', { amount: 4_500_000, amount_refunded: 0, metadata: { app: 'foundry', experiment_id: X } });
    const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
    await intakeStripeSettlement({ id: 'evt_door', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
      data: { object: { id: PAID, object: 'payment_intent', amount_received: 2900, currency: 'usd', metadata: { app: 'foundry', experiment_id: X, payment_link: link.id }, latest_charge: `ch_${PAID}` } } });
  });

  it('a genuinely owed key carrying another charge, or another amount, finds no act and moves nothing', async () => {
    const f = (await query('SELECT * FROM experiment_fulfilments WHERE payment_ref = ?', [PAID])).rows[0] as Record<string, unknown>;
    await query(`UPDATE experiment_fulfilments SET refund_requested_at = datetime('now') WHERE id = ?`, [String(f.id)]);
    const productId = String((await query('SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL', [X])).rows[0]!.id);
    const { invoke } = await import('../../src/services/outbound/gateway.js');
    const ask = (params: Record<string, unknown>) => invoke({ productId, tool: 'stripe_create_refund', action: 'adversarial', params,
      dedupKey: `experiment:${X}:refund:${PAID}`, customerExternalId: PAID, surface: 'billing', dataClass: 'customer' });
    const before = providers.state.refunds.length;
    expect((await ask({ charge_id: 'ch_land_sale', amount: 2900, reason: 'requested_by_customer' })).ok).toBe(false);
    expect((await ask({ charge_id: `ch_${PAID}`, amount: 4_500_000, reason: 'requested_by_customer' })).ok).toBe(false);
    expect(providers.state.refunds.length, 'nothing reached the provider').toBe(before);
    // The refund the purchase allows, built from its own row, goes through.
    const { refundParamsFor } = await import('../../src/services/institution/standing-intent.js');
    expect(refundParamsFor(f)).toEqual({ charge_id: `ch_${PAID}`, amount: 2900, reason: 'requested_by_customer' });
    const { refundFulfilment } = await import('../../src/services/venture/hand.js');
    expect(await refundFulfilment({ fulfilmentId: String(f.id), reason: 'the buyer asked' })).toEqual({ issued: true, refusedReason: null });
    expect(new URLSearchParams(providers.state.refunds.at(-1)!.body).get('charge')).toBe(`ch_${PAID}`);
  });

  it('a purchase with no charge on record is recorded and named, not lost', async () => {
    const { refundParamsFor } = await import('../../src/services/institution/standing-intent.js');
    expect(refundParamsFor({ charge_ref: null, payment_ref: 'pi_x', amount_cents: 500 })).toEqual({ payment_intent: 'pi_x', amount: 500, reason: 'requested_by_customer' });
    expect(refundParamsFor({ charge_ref: 'ch_w', payment_ref: 'in_w', amount_cents: 900 })).toEqual({ charge_id: 'ch_w', amount: 900, reason: 'requested_by_customer', invoice_id: 'in_w' });
    expect(refundParamsFor({ charge_ref: null, payment_ref: 'cs_x', amount_cents: 500 })).toBeNull();
  });
});
