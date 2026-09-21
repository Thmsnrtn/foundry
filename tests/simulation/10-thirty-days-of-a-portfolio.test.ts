// =============================================================================
// THIRTY DAYS OF A PORTFOLIO, WITH THE WORLD GOING WRONG.
//
// Two companies he named, a search open, a test allowed under a charter: the
// month an owner actually has. Then the world misbehaves in the ways it does:
// the mail provider is down the morning the hand writes; a buyer pays and the
// delivery bounces while the payment provider is down, so the refund cannot
// go through; the Workshop's edge is unreachable for a morning. Each is
// reported once where he would look, nothing is lost, nothing is sent twice,
// and when the provider returns the institution carries on from where it
// stopped. At the end, the letter, Home and the money reading agree.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { OWNER, addCompanies, advanceDays, asText, giveTheWorkshopEars, outage, owner, ownerApp, routinesRanThisMorning, runMorning, seedProductionShape } from '../helpers/world.js';

const { state, fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => say({ abstain: 'nothing to read' })),
  callOpus: vi.fn(async () => say({ abstain: 'nothing to read' })),
}));
afterAll(() => { vi.unstubAllGlobals(); });

const HANDS = ['public_workshop_tick', 'experiment_hand_tick', 'business_outcome_tick'] as const;
const stripe = new Stripe('sk_test_fake_key', { apiVersion: '2024-06-20' as never });
let seq = 0;
const signedEvent = (type: string, object: Record<string, unknown>): [string, string] => {
  const payload = JSON.stringify({ id: `evt_p_${++seq}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
  return [payload, stripe.webhooks.generateTestHeaderString({ payload, secret: String(process.env.STRIPE_WEBHOOK_SECRET) })];
};
let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
let approved = 0;
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const morning = async () => { const r = await runMorning(HANDS); await routinesRanThisMorning(); return r; };
const money = async () => (await import('../../src/services/founder/experiment-view.js')).moneyOfExperiment(X);
const offers = async () => (await query(`SELECT status, recipient_id FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer'`, [X])).rows as unknown as Array<{ status: string; recipient_id: string }>;

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({ unsettled: true, undecided: true, charter: true, searching: true }));
  app = await ownerApp();
  me = owner(app);
  await addCompanies(app, ['Acme Ledgers', 'Northwind Signs']);
  state.domains.push({ id: 'dom_w', name: 'apexmicro.ai', status: 'verified', records: [] });
  const { qualifyRecipient, recipientsOf } = await import('../../src/services/venture/hand.js');
  const mine = (await recipientsOf(X)).filter((x) => x.reviewStatus === 'approved');
  approved = mine.length;
  for (const r of mine) {
    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id,
      because: 'listed as a Massachusetts millwork or casework contractor on the state register', source: 'https://www.commbuys.com/bso/' });
  }
  const { standUpWorkshop } = await import('../../src/services/public-workshop/infrastructure.js');
  await standUpWorkshop(OWNER, fetchStub as unknown as typeof fetch);
  // AND ITS EARS: nobody is written to through a Workshop that cannot hear.
  await giveTheWorkshopEars(OWNER);
});

describe('day 1 — a portfolio, a search, a test allowed', () => {
  it('Home watches two companies, says it is looking, and the test is set aside for', async () => {
    const { allowExperiment } = await import('../../src/services/venture/hand.js');
    await allowExperiment({ founderId: OWNER, experimentId: X });
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('Watching 2 companies');
    expect(home).toContain('set aside for tests, nothing paid yet');
    expect((await money()).word).toBe('authorised');
  });
});

describe('day 2 — the mail provider is down the morning the hand writes', () => {
  it('nothing is sent, the failed offers are kept as failed, the page says the provider refused and that it will try again; no recipient is lost', async () => {
    await advanceDays(1);
    outage(state, 'resend', true);
    const ran = await morning();
    // The morning says so, once, naming the provider's answer; it does not pretend.
    const hand = ran.find((r) => r.job === 'experiment_hand_tick')!;
    expect(hand.ok).toBe(false);
    expect(hand.error).toMatch(/Resend API error 503/);
    expect(ran.filter((r) => !r.ok && r.job !== 'experiment_hand_tick')).toEqual([]);
    expect(state.sends).toHaveLength(0);
    const rows = await offers();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'failed')).toBe(true);
    const { handExceptions } = await import('../../src/services/venture/hand.js');
    const ex = await handExceptions(X);
    expect(ex.some((e) => /could not be sent .* provider .* try again/i.test(e))).toBe(true);
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toMatch(/could not be sent/);
  });

  it('day 3 — the provider is back: the same offers go out once each, and nobody is written to twice', async () => {
    await advanceDays(1);
    outage(state, 'resend', false);
    await morning();
    expect(state.sends.length).toBeGreaterThan(0);
    const rows = await offers();
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(0);
    const to = state.sends.map((s) => s.to[0]);
    expect(new Set(to).size).toBe(to.length);
    const perRecipient = new Map<string, number>();
    for (const r of rows) perRecipient.set(r.recipient_id, (perRecipient.get(r.recipient_id) ?? 0) + 1);
    expect([...perRecipient.values()].every((n) => n === 1)).toBe(true);
    const { handExceptions } = await import('../../src/services/venture/hand.js');
    expect((await handExceptions(X)).some((e) => /could not be sent/.test(e))).toBe(false);
  });
});

describe('day 5 — a buyer pays, the delivery bounces, and the payment provider is down when the refund is owed', () => {
  const buyer = 'info@hamelwoodworks.com';
  it('the purchase is owed, the delivery bounces, the refund cannot be issued and the page says it needs him', async () => {
    await advanceDays(2);
    for (const s of state.sends) state.deliveryState.set(s.id, 'delivered');
    await morning();
    // A fresh edition of the brief, pulled today, as the owner would before a delivery.
    const { recordMaterial, materialOf } = await import('../../src/services/venture/hand.js');
    const current = (await materialOf(X, 'deliverable'))!;
    await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'deliverable', title: current.title, body: current.body, pulledAt: new Date(), by: 'the owner' });
    state.buyers.set('pi_p_1', buyer);
    state.deliveryState.set(`next:${buyer}`, 'bounced');
    const { handleWebhook } = await import('../../src/services/billing/stripe.js');
    const [p, s] = signedEvent('payment_intent.succeeded', { id: 'pi_p_1', object: 'payment_intent', amount_received: 2900, currency: 'usd', receipt_email: buyer, latest_charge: 'ch_p_1', metadata: { app: 'foundry', experiment_id: X, primitive: 'sale' } });
    await handleWebhook(p, s);
    expect((await one('SELECT status FROM experiment_fulfilments WHERE experiment_id = ? AND payment_ref = ?', [X, 'pi_p_1'])).status).toBe('owed');
    await morning(); // the delivery is sent, and bounces
    await query(`UPDATE outbound_actions SET reconcile_after = '2026-01-01T00:00:00.000Z' WHERE experiment_id = ? AND status = 'executed' AND outcome_status = 'unresolved'`, [X]);
    outage(state, 'stripe', true);
    await morning(); // the bounce is read; the refund is owed and refused
    expect((await one('SELECT status, refund_ref FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_p_1'])).status).toBe('failed');
    expect(state.refunds).toHaveLength(0);
    const { handExceptions } = await import('../../src/services/venture/hand.js');
    expect((await handExceptions(X)).some((e) => /refund did not go through/.test(e))).toBe(true);
    // THE OBLIGATION IS ONE OBJECT, and it reaches him where he is: as an
    // exception on the test, on Economics as owed to a buyer, and — once the
    // door has had its day of retries — as the one thing on Home.
    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    const now = (await obligationsFor(OWNER)).find((o) => o.paymentRef === 'pi_p_1')!;
    expect(now).toMatchObject({ state: 'failed_refund_pending', action: 'nothing' });
    expect((await obligationsFor(OWNER, new Date(Date.now() + 25 * 3_600_000))).find((o) => o.paymentRef === 'pi_p_1')).toMatchObject({ action: 'refund_yourself' });
    const economics = asText(await me.page('/foundry/money'));
    expect(economics).toContain('Owed to buyers');
    expect(economics).toContain('pi_p_1');
    expect((await money()).paidCents).toBe(2900);
    expect((await money()).refundedCents).toBe(0);
  });

  it('day 6 — the provider is back: the refund is issued once, and the reading shows it', async () => {
    await advanceDays(1);
    outage(state, 'stripe', false);
    await morning();
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0]!.idempotency).toBe(`experiment:${X}:refund:pi_p_1`);
    await morning();
    expect(state.refunds).toHaveLength(1);
    const { handleWebhook } = await import('../../src/services/billing/stripe.js');
    const [p, s] = signedEvent('charge.refunded', { id: 'ch_p_1', object: 'charge', payment_intent: 'pi_p_1', currency: 'usd', amount_refunded: 2900, receipt_email: buyer, metadata: { app: 'foundry', experiment_id: X }, refunds: { data: [{ id: 're_p_1', amount: 2900 }] } });
    await handleWebhook(p, s);
    expect((await money()).refundedCents).toBe(2900);
  });
});

describe('day 7 — the Workshop\'s edge is unreachable for a morning', () => {
  it('the morning still completes; the publication is reported, not fatal; the next morning republishes', async () => {
    await advanceDays(1);
    outage(state, 'workshop', true);
    const ran = await morning();
    const hand = ran.find((r) => r.job === 'experiment_hand_tick')!;
    expect(hand.ok === false ? hand.error : 'ok').toMatch(/HTTP 503|ok/);
    expect(ran.filter((r) => !r.ok && r.job !== 'experiment_hand_tick' && r.job !== 'public_workshop_tick')).toEqual([]);
    outage(state, 'workshop', false);
    await advanceDays(1);
    const again = await morning();
    expect(again.filter((r) => !r.ok)).toEqual([]);
  });
});

describe('day 30 — the letter, Home and the money reading agree', () => {
  it('the test settled, the two companies are named as ones Foundry cannot see, the money is one reading', async () => {
    await advanceDays(22);
    await morning();
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    const o = (await outcomeOf(X))!;
    expect(o.settled).toBe(true);
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 30);
    expect(letter.outcomes.some((l) => new RegExp(`settled ${o.word} on`).test(l))).toBe(true);
    // The two companies nothing reports on are listed as ones Foundry cannot
    // see — never as quiet ones — where he asks whether he can step away.
    const { canIDisappear } = await import('../../src/services/founder/a-week-away.js');
    const away = await canIDisappear(OWNER);
    expect(away.blind).toEqual(expect.arrayContaining(['Acme Ledgers', 'Northwind Signs']));
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('Watching 2 companies');
    expect(home).toContain(o.label);
    const m = await money();
    expect(m.word).toBe('settled');
    expect(m.paidCents).toBe(2900);
    expect(m.refundedCents).toBe(2900);
    const answer = asText(await me.answer('Is anything making money yet?'));
    expect(answer).toContain('$29.00 has been paid by 1 customer, $29.00 of it refunded');
  });
});
