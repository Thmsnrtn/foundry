// =============================================================================
// THE FIRST REAL EXPERIMENT RUNS BY HAND; THE OWNER GOVERNS IT FROM HIS PHONE.
//
//   seed → review who may be contacted → connect his own sending address →
//   Allow (refused until then, by the rows) → Foundry places the payment link
//   → paced governed offers → provider receipts → offer_delivered events →
//   a signed purchase → what is owed → delivery, quality-checked → a bounce
//   refunded through the governed door → a delivered brief → the sealed rule
//   settles it → the buyer's refund link → Stop on another test.
//
// Providers are stubbed at the network edge so every handler, guard and row
// runs. This is proof that the operational path exists and that the owner's
// part is three acts on one page. It is not commercial evidence: no business
// was contacted and no money moved.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Stripe from 'stripe';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/resend.js';
import '../../src/services/integration/stripe-gateway.js';
import { handleWebhook } from '../../src/services/billing/stripe.js';
import { providerStubs, seedHandMadeLink } from '../helpers/provider-stubs.js';
import { PROOF1_PLAN, PROOF1_TITLE, seedProof1 } from '../../src/services/venture/proof-1.js';
import { BRIEF_MD, OUTREACH_TEMPLATE_MD } from '../../src/services/venture/proof-1-content.js';
import {
  addRecipients, allowExperiment, attachPaymentLinkByUrl, campaignActOf, planDelivery, readiness, recipientsOf, recordMaterial, reviewRecipient, runHand,
} from '../../src/services/venture/hand.js';
import { getExperimentView } from '../../src/services/founder/experiment-view.js';
import { exposureOf, whatTheWorldSaid } from '../../src/services/venture/outcome.js';
import { designExperiment } from '../../src/services/venture/validation.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';
const experimentHandTick = () => JOB_REGISTRY.experiment_hand_tick.fn();

const OWNER = 'h_owner'; const OTHER = 'h_other'; const FOUNDRY = 'h_foundry';
const stripe = new Stripe('sk_test_fake', { apiVersion: '2023-10-16' });
const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
/** The hand's clock: half a day after the brief was pulled, so the quality
 * gate sees it fresh whenever this runs, and earlier than the wall clock, so a
 * receipt is never read before its reconcile time has passed. */
const NOW = new Date('2026-09-08T00:00:00Z');
const { state, fetch: fetchStub } = providerStubs();
let seq = 100;
function signedEvent(type: string, object: Record<string, unknown>): [string, string] {
  const payload = JSON.stringify({ id: `evt_h_${++seq}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
  return [payload, stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })];
}

let app: Hono;
let currentFounder: Record<string, unknown> = { id: OWNER, email: 'thomas@example.com', preferences: {} };
let X = ''; // the experiment
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') ?? '' }; };
const post = (path: string, fields: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const redirectedTo = (r: Response) => r.headers.get('location') ?? '';
const pastDue = () => query(`UPDATE outbound_actions SET reconcile_after = '2026-01-01T00:00:00.000Z' WHERE experiment_id = ? AND status = 'executed' AND outcome_status = 'unresolved'`, [X]);

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?),(?,?,?,?)`,
    [OWNER, 'h_clk', 'thomas@example.com', 'Thomas Norton', OTHER, 'h_clk2', 'other@example.com', 'Other']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'rehearsal')`, [FOUNDRY]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  const { shareRoutes } = await import('../../src/routes/share/index.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, currentFounder as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
  app.route('/', shareRoutes);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('the owner\'s part is three acts on one page', () => {
  it('act 0 (Foundry): the design, the businesses and the brief exist as ordinary venture rows; nothing is sent, spent or permitted', async () => {
    // Production had a rehearsal search open; a real experiment cannot hang under it.
    const { openMandate, currentMandate } = await import('../../src/services/venture/mandate.js');
    const rehearsal = await openMandate({ founderId: OWNER, statement: 'Find another small digital income stream', shape: null, evidenceMode: 'reference' });
    if ('refused' in rehearsal) throw new Error(rehearsal.refused);
    const seeded = await seedProof1(OWNER);
    const now = (await currentMandate(OWNER))!;
    expect(now.evidenceMode).toBe('real');
    expect((await query('SELECT closed_reason FROM venture_mandates WHERE id = ?', [rehearsal.id])).rows[0]).toMatchObject({ closed_reason: expect.stringContaining('Proof 1') });
    X = seeded.experimentId;
    expect(seeded).toMatchObject({ recipientsAdded: 23, alreadyExisted: false });
    expect((await seedProof1(OWNER))).toMatchObject({ experimentId: X, recipientsAdded: 0, alreadyExisted: true });
    const e = (await query('SELECT decision, settles_when, needs_workshop, cost_cents FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(e).toMatchObject({ decision: null, needs_workshop: 0, cost_cents: 10_000 });
    expect(JSON.parse(String(e.settles_when))).toMatchObject({ event: 'delivery', at_least: 1, out_of: 'offer_delivered', at_most: 25, within_days: 7 });
    expect((await query('SELECT COUNT(*) AS n FROM market_observations WHERE claim_id = (SELECT claim_id FROM venture_experiments WHERE id = ?)', [X])).rows[0]).toMatchObject({ n: 4 });
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('needs_you');
    expect(v.steps.map((s) => `${s.key}:${s.status}`)).toEqual(['recipients:todo', 'sending:todo', 'allow:todo', 'placing:foundry']);
    expect(v.offer.deliverable).toMatchObject({ title: PROOF1_TITLE, quality: { ok: true, failures: [] } });
    expect(await getExperimentView(OTHER, X, NOW)).toBeNull();
    expect(await runHand({ now: NOW })).toEqual([]);
    expect(state.sends).toHaveLength(0);
    // The list and the Home queue both show it as his to move, with one place to go.
    expect((await page('/foundry/experiments')).text).toContain('Needs you');
    const home = (await page('/foundry')).text;
    expect(home).toContain('a real test');
    expect(home).toContain('Review who may be contacted');
    expect(home).not.toContain(`/foundry/experiments/${X}/allow`);
  });

  it('act 1 (owner): review who may be contacted; another founder is refused; nobody is born approved', async () => {
    const r = await page(`/foundry/experiments/${X}/recipients`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Exclude your employer');
    expect(r.text).toContain('The rest are fine (11)');
    const strike = (await recipientsOf(X)).find((x) => x.email === 'info@genwood.com')!;
    currentFounder = { id: OTHER, email: 'other@example.com', preferences: {} };
    expect((await post(`/foundry/experiments/${X}/recipients/${strike.id}`, { decision: 'struck' })).status).toBe(403);
    expect((await post(`/foundry/experiments/${X}/recipients/approve-remaining`)).status).toBe(403);
    expect((await page(`/foundry/experiments/${X}`)).status).toBe(403);
    currentFounder = { id: OWNER, email: 'thomas@example.com', preferences: {} };
    expect(redirectedTo(await post(`/foundry/experiments/${X}/recipients/${strike.id}`, { decision: 'struck', reason: 'employer relationship' }))).toContain('done=reviewed');
    expect(redirectedTo(await post(`/foundry/experiments/${X}/recipients/approve-remaining`))).toContain('done=reviewed');
    const after = await recipientsOf(X);
    expect(after.filter((x) => x.reviewStatus === 'approved')).toHaveLength(10);
    expect(after.filter((x) => x.reviewStatus === 'struck')).toHaveLength(1);
    expect(after.filter((x) => x.reviewStatus === 'pending')).toHaveLength(12); // web-form only: never written to unless he adds an address
    await expect(query(`INSERT INTO experiment_recipients (id,founder_id,experiment_id,counterparty_ref,email,channel,review_status) VALUES ('x',?,?,'Sneaky','s@x.com','email','approved')`, [OWNER, X])).rejects.toThrow(/review_not_owner_act/);
    await expect(reviewRecipient({ founderId: OTHER, experimentId: X, recipientId: after.find((x) => x.reviewStatus === 'pending')!.id, decision: 'approved', email: 'x@y.com' })).rejects.toThrow(/recipient_not_found/);
    await expect(query(`UPDATE experiment_recipients SET review_status='approved', reviewed_by='founder:${OTHER}', reviewed_at=datetime('now') WHERE id = ?`, [after.find((x) => x.reviewStatus === 'pending')!.id])).rejects.toThrow(/reviewer_invalid/);
    // A web-form business becomes reachable only with a published address he adds.
    const web = after.find((x) => x.channel === 'web_form')!;
    expect(redirectedTo(await post(`/foundry/experiments/${X}/recipients/${web.id}`, { decision: 'approved', email: 'office@masscabinetsinc.com' }))).toContain('done=reviewed');
    expect((await recipientsOf(X)).find((x) => x.id === web.id)).toMatchObject({ channel: 'email', email: 'office@masscabinetsinc.com', reviewStatus: 'approved' });
    expect((await readiness(X)).reachable).toBe(11);
  });

  it('Allow is refused while a prerequisite is missing, by the page and by the rows', async () => {
    const shown = (await page(`/foundry/experiments/${X}`)).text;
    expect(shown).toContain('Not yet.');
    expect(shown).toContain('email sending is not connected');
    expect(redirectedTo(await post(`/foundry/experiments/${X}/allow`))).toMatch(/error=not[+%]20ready/);
    await expect(allowExperiment({ founderId: OWNER, experimentId: X })).rejects.toThrow(/not_ready.*email sending is not connected/);
    expect(((await query('SELECT decision FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>).decision).toBeNull();
    expect(await exposureOf(X)).toBeNull();
    expect(state.sends).toHaveLength(0);
  });

  it('act 2 (owner): his own sending address on his own domain, checked with the provider; a Foundry address or an unverified domain is refused', async () => {
    expect(redirectedTo(await post(`/foundry/experiments/${X}/sending`, { from_email: 'hello@foundry.app', from_name: 'Thomas', credential: 're_key' }))).toMatch(/error=/);
    expect(redirectedTo(await post(`/foundry/experiments/${X}/sending`, { from_email: 'hello@mail.thomasnorton.example', from_name: 'Thomas', credential: 're_key' }))).toMatch(/error=.*no%20domains/);
    state.domains.push({ id: 'dom_1', name: 'mail.thomasnorton.example', status: 'pending', records: [] });
    expect(redirectedTo(await post(`/foundry/experiments/${X}/sending`, { from_email: 'hello@mail.thomasnorton.example', from_name: 'Thomas', credential: 're_key' }))).toMatch(/error=.*pending/);
    state.domains[0].status = 'verified';
    expect(redirectedTo(await post(`/foundry/experiments/${X}/sending`, { from_email: 'hello@mail.thomasnorton.example', from_name: 'Thomas Norton', credential: 're_key' }))).toContain('done=sending');
    const r = await readiness(X);
    expect(r.ok).toBe(true);
    expect(r.sending).toMatchObject({ status: 'ready', fromLine: 'Thomas Norton <hello@mail.thomasnorton.example>', identityProductId: FOUNDRY });
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('ready');
    const home = (await page('/foundry')).text;
    expect(home).toContain(`/foundry/experiments/${X}/allow`);
    expect(home).toContain('Allow the test');
  });

  it('act 3 (owner): Allow approves the test, seals the prediction, sets the allowance, approves one measurement-critical act; Foundry places the tagged link', async () => {
    const shown = (await page(`/foundry/experiments/${X}`)).text;
    expect(shown).toContain('Allow — up to $100.00');
    expect(shown).toContain('writes once to each of the 11 approved businesses');
    expect(redirectedTo(await post(`/foundry/experiments/${X}/allow`))).toContain('done=allowed');
    const e = (await query('SELECT decision, decided_by FROM venture_experiments WHERE id = ?', [X])).rows[0];
    expect(e).toMatchObject({ decision: 'approved', decided_by: `founder:${OWNER}` });
    const asset = (await query('SELECT id, standing, operating_boundary FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(asset).toMatchObject({ standing: 'experimental', operating_boundary: 'asset_only' });
    expect((await query('SELECT amount_cents FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL', [String(asset.id)])).rows[0]).toMatchObject({ amount_cents: 10_000 });
    expect((await query('SELECT COUNT(*) AS n FROM workspaces WHERE subject_id = ?', [X])).rows[0]).toMatchObject({ n: 0 });
    const act = (await campaignActOf(X))!;
    expect(act.decision).toBe('approved');
    expect((await query('SELECT subject, action_type, measurement_critical, rung, cost_cents FROM proposed_acts WHERE id = ?', [act.id])).rows[0])
      .toMatchObject({ subject: 'contact_people', action_type: 'send_email', measurement_critical: 1, rung: 'public', cost_cents: 0 });
    // The hand's clock runs behind the wall clock here (see NOW); the world
    // may not answer in the same second as the prediction, so the prediction
    // is dated before the clock, as the other settlement proofs do.
    await query(`UPDATE venture_experiments SET decided_at = '2026-09-07 13:00:00' WHERE id = ?`, [X]);
    // Twice is nothing: an approved test cannot be allowed again.
    expect(redirectedTo(await post(`/foundry/experiments/${X}/allow`))).toMatch(/error=already[+%]20decided/);
    // The link Foundry made on the shared account, tagged on the link and on the payment.
    const x = (await exposureOf(X))!;
    expect(x.provider).toBe('stripe');
    const link = state.paymentLinks.find((l) => l.id === x.exposureRef)!;
    expect(link.metadata).toMatchObject({ app: 'foundry', experiment_id: X });
    expect(link.payment_intent_data?.metadata).toMatchObject({ app: 'foundry', experiment_id: X });
    expect(state.prices.find((p) => p.id === link.line_items[0].price)).toMatchObject({ unit_amount: 2900, currency: 'usd', lookup_key: PROOF1_PLAN.price.lookupKey, recurring: null });
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('running');
    expect(v.offer.paymentLinkUrl).toBe(link.url);
    expect(v.offer.offerQuality).toEqual({ ok: true, failures: [] });
    expect(v.rules.success).toContain('at least 1 customer pays and receives what they bought before 25 businesses have received the offer, within 7 days');
    expect((await page('/foundry')).text).not.toContain(`/foundry/experiments/${X}/allow`);
    // A hand-made link that does not meet the contract is refused with reasons; one that does is accepted as the same exposure.
    const wrong = seedHandMadeLink(state, { experimentId: X, amount: 1900, recurring: true });
    const refused = await attachPaymentLinkByUrl({ experimentId: X, url: wrong });
    expect('refused' in refused && refused.refused).toMatch(/recurring.*19\.00/);
    expect(redirectedTo(await post(`/foundry/experiments/${X}/payment`, { url: 'https://evil.example/pay' }))).toMatch(/error=/);
  });
});

describe('Foundry operates: offers, receipts, exposures', () => {
  it('the hourly hand sends paced governed offers only to approved businesses, as the owner, once each', async () => {
    const reports = await runHand({ now: NOW, offersPerTick: 5 });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ experimentId: X, offersPlanned: 5, offersSent: 5, exceptions: [] });
    expect(state.sends).toHaveLength(5);
    const x = (await exposureOf(X))!;
    const link = state.paymentLinks.find((l) => l.id === x.exposureRef)!;
    for (const s of state.sends) {
      expect(s.from).toBe('Thomas Norton <hello@mail.thomasnorton.example>');
      expect(s.reply_to).toBe('hello@mail.thomasnorton.example');
      expect(s.text).toContain(link.url);
      expect(s.text).not.toContain('{Business name}');
      expect(s.text).not.toContain('[PAYMENT LINK]');
      expect(s.idempotency).toMatch(new RegExp(`^experiment:${X}:offer:rcpt_`));
    }
    expect(state.sends.some((s) => s.to[0] === 'info@genwood.com')).toBe(false);
    // The job wrapper is the same hand. Idempotent: the remaining six, then nothing.
    await experimentHandTick();
    expect(state.sends).toHaveLength(10);
    await runHand({ now: NOW, offersPerTick: 5 });
    expect(state.sends).toHaveLength(11);
    await runHand({ now: NOW, offersPerTick: 5 });
    expect(state.sends).toHaveLength(11);
    // Provider acknowledgment is not exposure: nothing is counted until delivery is confirmed.
    expect((await whatTheWorldSaid(x.id)).filter((s) => s.kind === 'offer_delivered')).toHaveLength(0);
    // The plan guard is the authority, not the hand: a message to somebody he did not approve cannot even be planned.
    const asset = (await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>;
    const act = (await campaignActOf(X))!;
    await expect(query(
      `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence, expires_at, effect_id, outcome_status, experiment_id, experiment_act, proposed_act_id)
       VALUES ('sneak', ?, 'institution:hand', 'resend', 'send_email', 0, 'pending_approval', ?, 'p', 'r', 1, '2030-01-01', 'sneak', 'unresolved', ?, 'offer', ?)`,
      [String(asset.id), JSON.stringify({ to: ['stranger@example.com'], subject: 's', html: 'h' }), X, act.id])).rejects.toThrow(/recipient_not_approved/);
  });

  it('delivery receipts become offer_delivered events; a bounce is a verified failure, never resent', async () => {
    state.deliveryState.set(state.sends[2].id, 'bounced');
    await pastDue();
    const reports = await runHand({ now: NOW });
    expect(reports[0].reconciled).toBe(11);
    const x = (await exposureOf(X))!;
    expect((await whatTheWorldSaid(x.id)).filter((s) => s.kind === 'offer_delivered')).toHaveLength(10);
    const bounced = state.sends[2];
    expect((await query(`SELECT outcome_status FROM outbound_actions WHERE experiment_id = ? AND json_extract(parameters_json,'$.to[0]') = ?`, [X, bounced.to[0]])).rows[0]).toMatchObject({ outcome_status: 'verified_failure' });
    expect(state.sends).toHaveLength(11);
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.exposure).toMatchObject({ sent: 11, delivered: 10, bounced: 1, killAt: 25 });
    expect(v.stateDetail).toContain('10 businesses have received the offer');
    expect(v.learned.headline).toContain('no one has paid yet');
    const shown = (await page(`/foundry/experiments/${X}`)).text;
    expect(shown).toContain('Running');
    expect(shown).toContain('10 of 25 before it stops itself');
  });
});

describe('Foundry operates: purchase, delivery, refund, settlement', () => {
  it('a stale brief is never delivered: the quality gate fails closed and the page says why', async () => {
    const buyer = 'info@hamelwoodworks.com';
    state.buyers.set('pi_h_bounce', buyer);
    const [p, s] = signedEvent('payment_intent.succeeded', { id: 'pi_h_bounce', object: 'payment_intent', amount_received: 2900, currency: 'usd', receipt_email: buyer, latest_charge: 'ch_h_2', metadata: { app: 'foundry', experiment_id: X, primitive: 'sale' } });
    await handleWebhook(p, s);
    const owed = (await query('SELECT id, status, charge_ref FROM experiment_fulfilments WHERE experiment_id = ? AND payment_ref = ?', [X, 'pi_h_bounce'])).rows[0] as Record<string, unknown>;
    expect(owed).toMatchObject({ status: 'owed', charge_ref: 'ch_h_2' });
    // Stale for the brief (pulled 09-07), still inside the seven-day window that opened at placement.
    const STALE = new Date('2026-09-14T18:00:00Z');
    await expect(planDelivery({ experimentId: X, fulfilmentId: String(owed.id), now: STALE })).rejects.toThrow(/deliverable_quality/);
    const stale = await runHand({ now: STALE });
    expect(stale[0].exceptions.join(' ')).toMatch(/deliverable_quality/);
    expect(state.sends.filter((m) => m.to[0] === buyer && m.subject === PROOF1_TITLE)).toHaveLength(0);
    // The payment alone settles nothing: the rule reads deliveries.
    expect(((await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>).ran_at).toBeNull();
  });

  it('a bounced delivery is refunded through the governed Stripe capability; a refunded purchase validates nothing', async () => {
    const buyer = 'info@hamelwoodworks.com';
    state.deliveryState.set(`next:${buyer}`, 'bounced');
    const first = await runHand({ now: NOW });
    expect(first[0]).toMatchObject({ deliveriesSent: 1, settled: null });
    const delivery = state.sends[state.sends.length - 1];
    expect(delivery.to).toEqual([buyer]);
    expect(delivery.subject).toBe(PROOF1_TITLE);
    expect(delivery.idempotency).toBe(`experiment:${X}:delivery:pi_h_bounce`);
    await pastDue();
    const second = await runHand({ now: NOW });
    expect(second[0]).toMatchObject({ refundsIssued: 1, settled: null });
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0].body).toContain('charge=ch_h_2');
    expect(state.refunds[0].idempotency).toBe(`experiment:${X}:refund:pi_h_bounce`);
    const [p, s] = signedEvent('charge.refunded', { id: 'ch_h_2', object: 'charge', payment_intent: 'pi_h_bounce', currency: 'usd', amount_refunded: 2900, receipt_email: buyer, metadata: { app: 'foundry', experiment_id: X }, refunds: { data: [{ id: 're_h_1', amount: 2900 }] } });
    await handleWebhook(p, s);
    expect((await query('SELECT status, refund_ref FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_h_bounce'])).rows[0]).toMatchObject({ status: 'refunded' });
    const x = (await exposureOf(X))!;
    const said = await whatTheWorldSaid(x.id);
    expect(said.filter((e) => e.kind === 'payment')).toHaveLength(1);
    expect(said.filter((e) => e.kind === 'refund')).toHaveLength(1);
    expect(said.filter((e) => e.kind === 'delivery')).toHaveLength(0);
    expect(((await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>).ran_at).toBeNull();
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.money).toMatchObject({ payments: 1, paidCents: 2900, refunds: 1, refundedCents: 2900 });
    expect(v.state).toBe('running');
  });

  it('a signed purchase opens what is owed; the same intent reported twice owes once; the delivery carries the brief and the refund link', async () => {
    const buyer = 'sales@rgcmillwork.com';
    state.buyers.set('pi_h_1', buyer);
    const [p1, s1] = signedEvent('checkout.session.completed', { id: 'cs_h_1', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_h_1', amount_total: 2900, currency: 'usd', payment_link: (await exposureOf(X))!.exposureRef, customer_details: { email: buyer }, metadata: { app: 'foundry', experiment_id: X } });
    await handleWebhook(p1, s1);
    const [p2, s2] = signedEvent('payment_intent.succeeded', { id: 'pi_h_1', object: 'payment_intent', amount_received: 2900, currency: 'usd', receipt_email: buyer, latest_charge: 'ch_h_1', metadata: { app: 'foundry', experiment_id: X, primitive: 'sale' } });
    await handleWebhook(p2, s2);
    expect((await query('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_h_1'])).rows[0]).toMatchObject({ n: 1 });
    expect((await query('SELECT charge_ref FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_h_1'])).rows[0]).toMatchObject({ charge_ref: 'ch_h_1' });
    // A payment at somebody else's link is not this experiment's.
    const [p3, s3] = signedEvent('checkout.session.completed', { id: 'cs_h_x', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_h_elsewhere', amount_total: 2900, currency: 'usd', payment_link: 'plink_not_ours', customer_details: { email: 'x@y.example' }, metadata: { app: 'foundry', experiment_id: X } });
    await handleWebhook(p3, s3);
    expect((await query('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?', ['pi_h_elsewhere'])).rows[0]).toMatchObject({ n: 0 });
    const r = await runHand({ now: NOW });
    expect(r[0].deliveriesSent).toBe(1);
    const delivery = state.sends.find((m) => m.to[0] === buyer && m.subject === PROOF1_TITLE)!;
    expect(delivery.subject).toBe(PROOF1_TITLE);
    expect(delivery.text).toContain('Coverage is limited to COMMBUYS');
    expect(delivery.html).toContain('<a href="https://www.commbuys.com/bso/external/bidDetail.sda?docId=BD-26-1507-FHA01-JJB01-132802');
    expect(delivery.text).toMatch(/\(http:\/\/localhost:8080\/share\/refund\/[A-Za-z0-9_-]+\/[a-f0-9]+\)/);
    expect(delivery.idempotency).toBe(`experiment:${X}:delivery:pi_h_1`);
    expect(state.sends.filter((m) => m.to[0] === buyer && m.subject === PROOF1_TITLE)).toHaveLength(1);
  });

  it('the delivery receipt is the paid event; the sealed rule settles it as predicted; nothing more is sent', async () => {
    await pastDue();
    const r = await runHand({ now: NOW });
    expect(r[0].settled).toBe('as_predicted');
    const e = (await query('SELECT verdict, what_happened, ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(e.verdict).toBe('as_predicted');
    expect(String(e.what_happened)).toMatch(/1 delivery that counted out of 10 offer_delivereds within 7 days.*As predicted\./);
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('completed');
    expect(v.learned.headline).toBe('The prediction held');
    expect(v.exceptions).toEqual([]);
    // The offer came down with the settlement: withdrawn here, deactivated at the provider.
    const x = (await exposureOf(X))!;
    expect(x.withdrawnAt).not.toBeNull();
    expect(state.paymentLinks.find((l) => l.id === x.exposureRef)!.active).toBe(false);
    expect(v.timeline.map((t) => t.kind)).toEqual(expect.arrayContaining(['Planned', 'Authorized', 'Attempted', 'Verified', 'Observed', 'Concluded', 'Learned']));
    const before = state.sends.length;
    expect(await runHand({ now: NOW })).toEqual([]);
    expect(state.sends.length).toBe(before);
    expect((await page('/foundry')).text).not.toContain('a real test');
    expect((await page(`/foundry/experiments/${X}`)).text).toContain('Completed');
  });

  it('the buyer refunds themselves through the signed link; with money tools off the request is recorded and the page shows it', async () => {
    const delivery = state.sends.find((m) => m.to[0] === 'sales@rgcmillwork.com' && m.subject === PROOF1_TITLE)!;
    const link = /\((http:\/\/localhost:8080\/share\/refund\/[^)]+)\)/.exec(delivery.text ?? '')![1];
    const path = link.replace('http://localhost:8080', '');
    expect(delivery.html).toContain(`<a href="${link}">ask for a refund here</a>`);
    expect((await app.request(`${path}x`)).status).toBe(404);
    expect((await app.request(path.replace(/\/share\/refund\/[^/]+\//, '/share/refund/nope_nope_nope/'))).status).toBe(404);
    const shown = await page(path);
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('Refund $29.00?');
    expect(state.refunds).toHaveLength(1);
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'false';
    const blocked = await app.request(path, { method: 'POST' });
    expect(await blocked.text()).toContain('Request recorded');
    expect(state.refunds).toHaveLength(1);
    // The request is on the row, in the timeline, and on the page as the owner's exception.
    const asked = (await getExperimentView(OWNER, X, NOW))!;
    expect(asked.timeline.some((t) => /refund was requested for payment pi_h_1/.test(t.text))).toBe(true);
    expect(asked.exceptions.join(' ')).toMatch(/asked for a refund through the delivery link \(payment pi_h_1\)/);
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
    const refunded = await app.request(path, { method: 'POST' });
    expect(await refunded.text()).toContain('on its way back');
    expect(state.refunds).toHaveLength(2);
    expect((await getExperimentView(OWNER, X, NOW))!.exceptions).toEqual([]);
    expect(state.refunds[1].body).toContain('charge=ch_h_1');
    expect(await (await app.request(path, { method: 'POST' })).text()).toContain('Already refunded');
    expect(state.refunds).toHaveLength(2);
  });
});

describe('Stop, and nothing he can press dead-ends', () => {
  let Y = '';
  it('a second test is allowed and then stopped from the page: permission withdrawn, offer withdrawn, asset retired, hand idle', async () => {
    const e = (await query('SELECT opportunity_id, unknown_id, claim_id FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    // The first test answered its unknown; a second test needs a question of its own.
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, claim_id, question, blocking) VALUES ('u_second', ?, ?, ?, 'would a second set of shops pay too?', 1)`, [OWNER, String(e.opportunity_id), String(e.claim_id)]);
    Y = await designExperiment({ founderId: OWNER, opportunityId: String(e.opportunity_id), unknownId: 'u_second', claimId: String(e.claim_id), evidenceMode: 'real', costCents: 5000,
      whatWeDo: 'Offer the same brief to a second set of shops', whatWeExpect: 'one pays and receives it', wouldDisprove: 'nobody does', settlesWhen: { event: 'delivery', atLeast: 1, outOf: 'offer_delivered', atMost: 10, withinDays: 7 } });
    await query('UPDATE venture_experiments SET needs_workshop = 0 WHERE id = ?', [Y]);
    const by = 'test';
    await recordMaterial({ founderId: OWNER, experimentId: Y, kind: 'deliverable', title: 'Second brief', body: BRIEF_MD, pulledAt: new Date('2026-09-07T12:00:00Z'), by });
    await recordMaterial({ founderId: OWNER, experimentId: Y, kind: 'offer_template', title: PROOF1_PLAN.offerSubject, body: OUTREACH_TEMPLATE_MD, by });
    await recordMaterial({ founderId: OWNER, experimentId: Y, kind: 'offer_shape', title: 'shape', body: JSON.stringify({ ...PROOF1_PLAN, price: { ...PROOF1_PLAN.price, lookupKey: 'foundry_second_brief' } }), by });
    await addRecipients({ founderId: OWNER, experimentId: Y, recipients: [{ counterpartyRef: 'A Shop, Lowell', email: 'shop@example.com', channel: 'email' }] });
    expect(redirectedTo(await post(`/foundry/experiments/${Y}/recipients/approve-remaining`))).toContain('done=reviewed');
    expect(redirectedTo(await post(`/foundry/experiments/${Y}/allow`))).toContain('done=allowed');
    expect((await getExperimentView(OWNER, Y, NOW))!.controls.canStop).toBe(true);
    expect(redirectedTo(await post(`/foundry/experiments/${Y}/stop`, { reason: '' }))).toMatch(/error=reason[+%]20required/);
    expect(redirectedTo(await post(`/foundry/experiments/${Y}/stop`, { reason: 'changed my mind' }))).toContain('done=stopped');
    const act = (await campaignActOf(Y))!;
    expect(act.revokedAt).not.toBeNull();
    const xy = (await exposureOf(Y))!;
    expect(xy.withdrawnAt).not.toBeNull();
    expect(state.paymentLinks.find((l) => l.id === xy.exposureRef)!.active).toBe(false);
    expect((await query(`SELECT COUNT(*) AS n FROM proposed_acts WHERE experiment_id = ? AND revoked_at IS NULL AND decision = 'approved'`, [Y])).rows[0]).toMatchObject({ n: 0 });
    expect((await query('SELECT status, retired_because FROM products WHERE from_experiment_id = ?', [Y])).rows[0]).toMatchObject({ status: 'archived', retired_because: 'you stopped it: changed my mind' });
    const before = state.sends.length;
    expect(await runHand({ now: NOW })).toEqual([]);
    expect(state.sends.length).toBe(before);
    const v = (await getExperimentView(OWNER, Y, NOW))!;
    expect(v.state).toBe('stopped');
    expect(v.stateLabel).toBe('Stopped by you');
    expect(v.timeline.some((t) => /Permission withdrawn: changed my mind/.test(t.text))).toBe(true);
    expect((await page(`/foundry/experiments/${Y}`)).text).toContain('Stopped by you');
  });

  it('every link and form on the experiment pages leads to a page he can read', async () => {
    const seen = new Set<string>();
    for (const start of ['/foundry/experiments', `/foundry/experiments/${X}`, `/foundry/experiments/${X}/recipients`, `/foundry/experiments/${Y}`]) {
      const r = await page(start);
      expect(r.status, start).toBe(200);
      expect(r.type).toContain('text/html');
      for (const m of r.text.matchAll(/<a[^>]*href="(\/foundry[^"#?]*)"/g)) {
        const href = m[1];
        if (seen.has(href)) continue;
        seen.add(href);
        const linked = await app.request(href);
        expect([200, 302].includes(linked.status), `${href} from ${start} → ${linked.status}`).toBe(true);
      }
      for (const f of r.text.matchAll(/<form[^>]*action="(\/[^"]+)"/g)) {
        expect(f[1].startsWith('/foundry'), f[1]).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});
