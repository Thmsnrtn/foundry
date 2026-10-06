// =============================================================================
// STRIPE REPLAYS MID-CAMPAIGN — one sale, delivered many ways.
//
// A test is running on stubbed providers with its offer placed, so a sale has
// somewhere to land. A properly signed `payment_intent.succeeded` for it is
// posted to the REAL `/webhooks/stripe` route — the application's own Hono
// app from `src/index.ts`, which mounts it inline (there is no router to
// mount, and `crawl.ts` omits it). Then the provider does what providers do:
// retries it five times, a tampered body arrives under the old signature, a
// ten-minute-old delivery arrives, ten copies arrive at once, and one names
// a test that does not exist. Exactly one sale may be recorded.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';

import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/db/client.js';
import { providerStubs } from '../../helpers/provider-stubs.js';
import { HANDS, OWNER, advanceDays, giveTheWorkshopEars, routinesRanThisMorning, runMorning, seedProductionShape } from '../../helpers/world.js';
import { stripeSignature } from './campaign-helpers.js';

const { state, fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => say({ abstain: 'nothing to read' })),
  callOpus: vi.fn(async () => say({ abstain: 'nothing to read' })),
}));
afterAll(() => { vi.unstubAllGlobals(); });

const SECRET = String(process.env.STRIPE_WEBHOOK_SECRET);
let app: Hono;
let X = '';
const buyer = 'info@hamelwoodworks.com';
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const n = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

/** The provider's object for a sale of this test, as Stripe sends it. */
const paymentIntent = (pi: string, ch: string, experimentId: string, amount = 2900) => ({
  id: pi, object: 'payment_intent', amount, amount_received: amount, currency: 'usd', receipt_email: buyer, latest_charge: ch,
  metadata: { app: 'foundry', experiment_id: experimentId, primitive: 'sale' },
});
const eventJson = (id: string, object: Record<string, unknown>, created = Math.floor(Date.now() / 1000)) =>
  JSON.stringify({ id, object: 'event', type: 'payment_intent.succeeded', created, livemode: false, data: { object } });
const post = (path: string, payload: string, signature: string) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload,
});

/** What the ledgers hold for one payment reference. */
async function recordedFor(pi: string, ch: string) {
  return {
    claims: await n('SELECT COUNT(*) AS n FROM stripe_webhook_events WHERE event_id LIKE ?', [`evt_c_${pi.slice(-1)}%`]),
    outcomes: await n(`SELECT COUNT(*) AS n FROM business_outcome_events WHERE kind = 'payment' AND provider_event_ref = ?`, [pi]),
    fulfilments: await n('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?', [pi]),
    charges: await n(`SELECT COUNT(*) AS n FROM economic_events WHERE kind = 'charge' AND provider_ref = ?`, [ch]),
  };
}

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({ unsettled: true, undecided: true, charter: true }));
  state.domains.push({ id: 'dom_w', name: 'apexmicro.ai', status: 'verified', records: [] });
  const { qualifyRecipient, recipientsOf } = await import('../../../src/services/venture/hand.js');
  for (const r of (await recipientsOf(X)).filter((x) => x.reviewStatus === 'approved')) {
    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id,
      because: 'listed as a Massachusetts millwork or casework contractor on the state register', source: 'https://www.commbuys.com/bso/' });
  }
  const { standUpWorkshop } = await import('../../../src/services/public-workshop/infrastructure.js');
  await standUpWorkshop(OWNER, fetchStub as unknown as typeof fetch);
  await giveTheWorkshopEars(OWNER);
  const { allowExperiment } = await import('../../../src/services/venture/hand.js');
  await allowExperiment({ founderId: OWNER, experimentId: X });
  // The hand places the offer, so the test has an exposure a sale can land on.
  await advanceDays(1);
  const ran = await runMorning(HANDS);
  await routinesRanThisMorning();
  if (ran.some((r) => !r.ok)) throw new Error(`the morning did not run: ${ran.filter((r) => !r.ok).map((r) => `${r.job}: ${r.error ?? ''}`).join('; ')}`);
  // The provider holds the charges the events will name, tagged as Foundry tags them.
  for (const k of ['1', '2']) {
    state.buyers.set(`pi_c_${k}`, buyer);
    state.charges.set(`ch_c_${k}`, { amount: 2900, amount_refunded: 0, metadata: { app: 'foundry', experiment_id: X, primitive: 'sale' } });
  }
  // THE APPLICATION'S OWN APP, with the webhook mounted as src/index.ts mounts it.
  app = (await import('../../../src/index.js')).default as unknown as Hono;
}, 120_000);

describe('the sale lands once', () => {
  it('the exposure exists, so the sale has a place to be recorded', async () => {
    const { exposureOf } = await import('../../../src/services/venture/outcome.js');
    const x = await exposureOf(X);
    expect(x).not.toBeNull();
    expect(x!.provider).toBe('stripe');
  });

  let payload = '';
  let signature = '';
  it('a properly signed payment_intent.succeeded is accepted and recorded exactly once', async () => {
    payload = eventJson('evt_c_1', paymentIntent('pi_c_1', 'ch_c_1', X));
    signature = stripeSignature(payload, SECRET);
    const r = await post('/webhooks/stripe', payload, signature);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: true });
    expect(await recordedFor('pi_c_1', 'ch_c_1')).toEqual({ claims: 1, outcomes: 1, fulfilments: 1, charges: 1 });
    expect(String((await one('SELECT status FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_c_1'])).status)).toBe('owed');
  });

  it('replayed five times, byte for byte, it is answered 200 and recorded no further', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post('/webhooks/stripe', payload, signature);
      expect(r.status).toBe(200);
    }
    expect(await recordedFor('pi_c_1', 'ch_c_1')).toEqual({ claims: 1, outcomes: 1, fulfilments: 1, charges: 1 });
  });

  it('a tampered body under the old signature is refused 4xx and records nothing', async () => {
    const tampered = payload.replace('"amount_received":2900', '"amount_received":290000');
    expect(tampered).not.toBe(payload);
    const r = await post('/webhooks/stripe', tampered, signature);
    expect(r.status).toBe(400);
    expect(await recordedFor('pi_c_1', 'ch_c_1')).toEqual({ claims: 1, outcomes: 1, fulfilments: 1, charges: 1 });
    expect(Number((await one('SELECT amount_cents FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_c_1'])).amount_cents)).toBe(2900);
  });

  it('a delivery signed ten minutes ago is refused 4xx: the signature is valid and too old', async () => {
    const stale = eventJson('evt_c_1_stale', paymentIntent('pi_c_1', 'ch_c_1', X));
    const r = await post('/webhooks/stripe', stale, stripeSignature(stale, SECRET, Math.floor(Date.now() / 1000) - 600));
    expect(r.status).toBe(400);
    expect(await n('SELECT COUNT(*) AS n FROM stripe_webhook_events WHERE event_id = ?', ['evt_c_1_stale'])).toBe(0);
    expect(await recordedFor('pi_c_1', 'ch_c_1')).toEqual({ claims: 1, outcomes: 1, fulfilments: 1, charges: 1 });
  });

  it('a wrong signature with a fresh timestamp is refused 4xx', async () => {
    const r = await post('/webhooks/stripe', payload, stripeSignature(payload, 'whsec_not_ours'));
    expect(r.status).toBe(400);
    const missing = await post('/webhooks/stripe', payload, '');
    expect(missing.status).toBe(400);
  });
});

describe('ten copies at once', () => {
  it('a second sale delivered ten times concurrently is claimed once and recorded once', async () => {
    const payload = eventJson('evt_c_2', paymentIntent('pi_c_2', 'ch_c_2', X));
    const signature = stripeSignature(payload, SECRET);
    const answers = await Promise.all(Array.from({ length: 10 }, () => post('/webhooks/stripe', payload, signature)));
    expect(answers.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await recordedFor('pi_c_2', 'ch_c_2')).toEqual({ claims: 1, outcomes: 1, fulfilments: 1, charges: 1 });
    // And the money reading he opens agrees: two customers, $58.00, nothing refunded.
    const { moneyOfExperiment } = await import('../../../src/services/founder/experiment-view.js');
    const m = await moneyOfExperiment(X);
    expect(m.paidCents).toBe(5800);
    expect(m.refundedCents).toBe(0);
  });
});

describe('a sale for a test that does not exist', () => {
  it('is signed and well-formed, is answered, and records no sale anywhere', async () => {
    const before = await n('SELECT COUNT(*) AS n FROM business_outcome_events');
    const payload = eventJson('evt_c_3', paymentIntent('pi_c_3', 'ch_c_3', 'exp_does_not_exist'));
    const r = await post('/webhooks/stripe', payload, stripeSignature(payload, SECRET));
    expect([200, 400]).toContain(r.status);
    expect(await n('SELECT COUNT(*) AS n FROM business_outcome_events')).toBe(before);
    expect(await n('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_c_3'])).toBe(0);
    expect(await n(`SELECT COUNT(*) AS n FROM economic_events WHERE provider_ref = 'ch_c_3'`)).toBe(0);
    // DECIDED (remediation 1.6): acknowledged, with the reason kept on the
    // claim — this endpoint hears every event on a shared account, and a
    // payment tagged for a test is read from Stripe's own list each day
    // whatever the webhook did, so nothing is lost by not being retried.
    const claimed = await n('SELECT COUNT(*) AS n FROM stripe_webhook_events WHERE event_id = ?', ['evt_c_3']);
    process.stdout.write(`unknown test: answered ${String(r.status)}; event claim kept = ${String(claimed)}\n`);
    expect(r.status).toBe(200);
    expect(claimed).toBe(1);
    const why = (await query('SELECT unmatched_because FROM stripe_webhook_events WHERE event_id = ?', ['evt_c_3'])).rows[0] as Record<string, unknown>;
    expect(String(why.unmatched_because)).toMatch(/pi_c_3: no purchase of ours matches|the experiment has no exposure/);
    const { productionFacts, canSellOnItsOwn } = await import('../../../src/services/control/production-facts.js');
    const said = canSellOnItsOwn(await productionFacts(OWNER));
    expect(said.costs.join(' ')).toMatch(/payment event in the last thirty days carried Foundry's tag and matched no test/);
  });

  it('the per-company door refuses a company that does not exist with 404, before any chain runs', async () => {
    const payload = eventJson('evt_c_4', paymentIntent('pi_c_4', 'ch_c_4', X));
    const r = await post('/webhooks/stripe/prod_does_not_exist', payload, stripeSignature(payload, SECRET));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Unknown product' });
    expect(await n('SELECT COUNT(*) AS n FROM stripe_webhook_events WHERE event_id = ?', ['evt_c_4'])).toBe(0);
  });
});
