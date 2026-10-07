// =============================================================================
// A SUBSCRIPTION CAN ALWAYS BE STOPPED.
//
//   a weekly offer is let in only when the owner has allowed subscriptions
//   AND Foundry's money switch is on, because that switch is what lets it
//   cancel one → the stop is approved with the start, and outlives the test →
//   every week's email carries a signed cancel link → the buyer's link stops
//   it at the end of the week paid, through the door, once → when the owner
//   stops the test, or the act allowing deliveries nears its end, every
//   subscription it started is stopped → a stop the door refuses is retried
//   every pass, and the asset does not retire under a charge that will come
//   again → a subscription the provider already ended is recorded as stopped
//   → a second week is a new edition or it waits → the door lets the act do
//   exactly one thing to a subscription: end it at the paid week.
//
// And the page says so: weekly until you cancel, how to cancel, and that
// nothing is charged after — or it is not published.
//
// Nobody real is written to and nothing is charged; every provider is stubbed
// at the network edge.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';
import { renewalPromiseMissing } from '../../src/services/public-workshop/publication.js';
import { renderExperiment } from '../../src/services/public-workshop/site.js';
import type { PublicExperiment } from '../../src/services/public-workshop/projection.js';
import { EXCHANGES_THE_HANDS_CARRY, WEEKLY_BAND, subscriptionFacts } from '../../src/services/venture/products/offer-composition.js';

let X = '';
let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;
let app: Awaited<ReturnType<typeof ownerApp>>;
const rowsOf = async (sql: string, p: unknown[] = []) => (await query(sql, p)).rows as unknown as Array<Record<string, unknown>>;
const weekOf = async (invoice: string) => (await rowsOf('SELECT * FROM experiment_fulfilments WHERE payment_ref = ?', [invoice]))[0]!;
const stopOf = async (sub: string) => (await rowsOf('SELECT * FROM subscription_cancellations WHERE subscription_ref = ?', [sub]))[0];

/** A week is paid: the provider holds the subscription and the invoice, and the webhook says so. */
const aWeekIsPaid = async (invoice: string, sub: string, email: string): Promise<void> => {
  providers.state.subscriptions.set(sub, providers.state.subscriptions.get(sub) ?? { status: 'active', cancel_at_period_end: false, metadata: { app: 'foundry', experiment_id: X } });
  providers.state.invoices.set(invoice, { customer_email: email, charge: `ch_${invoice}` });
  const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
  await intakeStripeSettlement({
    id: `evt_${invoice}`, type: 'invoice.paid', created: Math.floor(Date.now() / 1000),
    data: { object: { object: 'invoice', id: invoice, amount_paid: 900, currency: 'usd', customer_email: email, charge: `ch_${invoice}`,
      parent: { subscription_details: { subscription: sub, metadata: { app: 'foundry', experiment_id: X } } } } },
  });
};

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  providers = seeded.providers!;
  await advanceDays(1);
  await runMorning(HANDS);
  app = await ownerApp();
}, 180_000);

describe('a weekly offer is let in only when it can be stopped', () => {
  it('is refused while the first-proof rule stands, then while the money switch is off, then allowed', async () => {
    const { subscriptionsRunnable } = await import('../../src/services/venture/hand.js');
    expect(await subscriptionsRunnable(OWNER)).toMatchObject({ ok: false, code: 'subscriptions_not_allowed' });
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'no_recurring_billing', treatment: 'penalise',
      why: 'the owner allowed subscriptions on Control', by: `founder:${OWNER}` });
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'false';
    expect(await subscriptionsRunnable(OWNER)).toMatchObject({ ok: false, code: 'subscription_cannot_be_stopped' });
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
    expect(await subscriptionsRunnable(OWNER)).toEqual({ ok: true });
  });

  it('the hands carry it at a weekly price, and say the charge recurs as an enforced fact', () => {
    expect(EXCHANGES_THE_HANDS_CARRY).toContain('subscription');
    expect(WEEKLY_BAND).toEqual({ lowDollars: 3, highDollars: 15 });
    const facts = subscriptionFacts();
    expect(facts.recurring_billing).toMatchObject({ present: 1, basis: 'enforced' });
    expect(facts.recurring_billing.enforcedBy).toMatch(/stopWhatRecurs/);
    expect(facts.one_visit_delivery.present).toBe(0);
  });

  it('the stop is approved with the start, as an act on the financial rung', async () => {
    const { approveTheStop, experimentRow } = await import('../../src/services/venture/hand.js');
    const e = (await experimentRow(X))!;
    await approveTheStop({ productId: e.productId!, experimentId: X, by: `founder:${OWNER}`, validForHours: 21 * 24 });
    const [act] = await rowsOf(`SELECT * FROM proposed_acts WHERE experiment_id = ? AND action_type = 'stripe_update_subscription'`, [X]);
    expect(act).toMatchObject({ subject: 'move_money', decision: 'approved' });
    expect(String(act!.summary)).toMatch(/stands after it expires and after the test ends/);
  });
});

describe('every week carries the way out', () => {
  it('a paid week is recorded with the subscription it belongs to, and delivered with a cancel link', async () => {
    await aWeekIsPaid('in_week1', 'sub_one', 'one@millwork.example');
    expect(String((await weekOf('in_week1')).subscription_ref)).toBe('sub_one');
    const before = providers.state.sends.length;
    await runMorning(HANDS);
    const sent = providers.state.sends.slice(before).find((m) => m.to.includes('one@millwork.example'));
    expect(sent, 'the week went to the subscriber').toBeTruthy();
    expect(sent!.text).toMatch(/this week's/);
    expect(sent!.text).toMatch(/\/share\/cancel\/[A-Za-z0-9_-]+\/[0-9a-f]{64}/);
    expect(sent!.text).toMatch(/nothing is charged after the week you've paid for/);
    expect(sent!.text).toMatch(/\/share\/refund\//);
  });

  it('a second week waits for a new edition rather than sending the same one again', async () => {
    await aWeekIsPaid('in_week2', 'sub_one', 'one@millwork.example');
    const { planDelivery } = await import('../../src/services/venture/hand.js');
    await expect(planDelivery({ experimentId: X, fulfilmentId: String((await weekOf('in_week2')).id) })).rejects.toThrow(/has not been made again since last week/);
    const { materialOf, recordMaterial } = await import('../../src/services/venture/hand.js');
    const last = (await materialOf(X, 'deliverable'))!;
    await new Promise((r) => { setTimeout(r, 1100); });
    await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'deliverable', title: last.title, body: `${last.body}\n`, pulledAt: new Date(), by: 'test' });
    const plan = await planDelivery({ experimentId: X, fulfilmentId: String((await weekOf('in_week2')).id) });
    expect(plan.status).toBe('pending_approval');
  });
});

describe('the buyer\'s link stops it', () => {
  const linkOf = async (invoice: string): Promise<string> => {
    const { cancelLinkFor } = await import('../../src/services/venture/hand.js');
    const link = cancelLinkFor(String((await weekOf(invoice)).id));
    return link.slice(link.indexOf('/share/'));
  };

  it('a forged or borrowed link finds nothing', async () => {
    const path = await linkOf('in_week1');
    expect((await app.request(path.replace(/\/[0-9a-f]{64}$/, `/${'0'.repeat(64)}`))).status).toBe(404);
    const { cancelLinkFor } = await import('../../src/services/venture/hand.js');
    // A link signed for a refund is not a link signed for a stop.
    const { refundLinkFor } = await import('../../src/services/venture/hand.js');
    const id = String((await weekOf('in_week1')).id);
    const refundToken = refundLinkFor(id).split('/').pop()!;
    expect(cancelLinkFor(id).endsWith(refundToken)).toBe(false);
    expect((await app.request(`/share/cancel/${id}/${refundToken}`)).status).toBe(404);
  });

  it('shows what stops and asks once; confirming stops it at the end of the paid week, through the door', async () => {
    const path = await linkOf('in_week1');
    const page = await (await app.request(path)).text();
    expect(page).toMatch(/Cancel your subscription\?/);
    expect(page).toMatch(/\$9\.00 a week/);
    const done = await (await app.request(path, { method: 'POST' })).text();
    expect(done).toMatch(/ends with the week you've paid for/);
    const update = providers.state.subscriptionUpdates.find((u) => u.id === 'sub_one')!;
    expect(new URLSearchParams(update.body).get('cancel_at_period_end')).toBe('true');
    expect(update.idempotency).toBe(`experiment:${X}:cancel:sub_one`);
    expect(await stopOf('sub_one')).toMatchObject({ asked_by: 'buyer' });
    expect((await stopOf('sub_one'))!.cancelled_at).not.toBeNull();
    // And again: already stopped, and nothing more is asked of the provider.
    const again = providers.state.subscriptionUpdates.length;
    expect(await (await app.request(path, { method: 'POST' })).text()).toMatch(/Cancelled/);
    expect(providers.state.subscriptionUpdates.length).toBe(again);
  });
});

describe('the door lets the act do exactly one thing', () => {
  it('a stop with anything but "end at the paid week" finds no act, and neither does an unrecorded ask', async () => {
    await aWeekIsPaid('in_other', 'sub_other', 'other@millwork.example');
    const { experimentRow } = await import('../../src/services/venture/hand.js');
    const productId = (await experimentRow(X))!.productId!;
    const fid = String((await weekOf('in_other')).id);
    const { invoke } = await import('../../src/services/outbound/gateway.js');
    const ask = (body: Record<string, string>) => invoke({ productId, tool: 'stripe_update_subscription', action: 'adversarial',
      params: { subscription_id: 'sub_other', body }, dedupKey: `experiment:${X}:cancel:sub_other`, customerExternalId: 'sub_other', surface: 'billing', dataClass: 'customer' });
    const before = providers.state.subscriptionUpdates.length;
    // No row says anybody asked: the door finds no act.
    expect((await ask({ cancel_at_period_end: 'true' })).ok).toBe(false);
    await query(`INSERT INTO subscription_cancellations (id, founder_id, experiment_id, fulfilment_id, subscription_ref, asked_by)
      VALUES ('sc_adv', ?, ?, ?, 'sub_other', 'buyer')`, [OWNER, X, fid]);
    // A row exists, but the change asked for is a new price, not a stop.
    expect((await ask({ 'items[0][price]': 'price_dearer' })).ok).toBe(false);
    expect((await ask({ cancel_at_period_end: 'true', 'items[0][price]': 'price_dearer' })).ok).toBe(false);
    expect(providers.state.subscriptionUpdates.length, 'nothing reached the provider').toBe(before);
    await query(`DELETE FROM subscription_cancellations WHERE id = 'sc_adv'`, []);
  });
});

describe('a stop the door refuses is not forgotten', () => {
  it('with the money switch off the ask is kept, the asset does not retire, and the next pass stops it', async () => {
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'false';
    const { cancelSubscription, experimentRow } = await import('../../src/services/venture/hand.js');
    const r = await cancelSubscription({ fulfilmentId: String((await weekOf('in_other')).id), askedBy: 'buyer' });
    expect(r.stopped).toBe(false);
    expect(String((await stopOf('sub_other'))!.refused_reason)).toMatch(/FOUNDRY_ENABLE_MONEY_TOOLS is off/);
    const { STILL_RECURS } = await import('../../src/services/venture/obligations.js');
    expect((await rowsOf(`SELECT 1 FROM experiment_fulfilments f WHERE f.experiment_id = ? AND ${STILL_RECURS('f')}`, [X])).length).toBeGreaterThan(0);
    const productId = (await experimentRow(X))!.productId!;
    const { retireExperimentalAsset } = await import('../../src/services/venture/asset.js');
    expect(await retireExperimentalAsset({ productId, because: 'trying' })).toBe(false);
    const { stopWhatRecurs: stillRefused } = await import('../../src/services/venture/hand.js');
    expect((await stillRefused(X)).exceptions.join(' '), 'the owner is told a buyer asked and is still charged').toMatch(/sub_other still charges every week although its buyer asked to cancel/);
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
    const { stopWhatRecurs } = await import('../../src/services/venture/hand.js');
    expect((await stopWhatRecurs(X)).stopped).toBe(1);
    expect((await stopOf('sub_other'))!.cancelled_at).not.toBeNull();
    expect((await stopOf('sub_other'))!.asked_by, 'the buyer asked first, and the row says so').toBe('buyer');
  });

  it('a subscription the provider already ended is recorded as stopped, not asked about for ever', async () => {
    await aWeekIsPaid('in_gone', 'sub_gone', 'gone@millwork.example');
    providers.state.subscriptions.set('sub_gone', { status: 'canceled', cancel_at_period_end: false, metadata: { app: 'foundry', experiment_id: X } });
    const { cancelSubscription } = await import('../../src/services/venture/hand.js');
    expect(await cancelSubscription({ fulfilmentId: String((await weekOf('in_gone')).id), askedBy: 'buyer' })).toEqual({ stopped: true, refusedReason: null });
  });
});

describe('when the test can deliver no more weeks, every subscription stops', () => {
  it('a live test leaves its subscribers alone', async () => {
    await aWeekIsPaid('in_live', 'sub_live', 'live@millwork.example');
    const { stopWhatRecurs } = await import('../../src/services/venture/hand.js');
    expect(await stopWhatRecurs(X)).toEqual({ stopped: 0, exceptions: [] });
    expect(await stopOf('sub_live')).toBeUndefined();
  });

  it('as the act allowing deliveries nears its end, they are told to end with the week paid', async () => {
    const { STOP_AHEAD_DAYS, stopWhatRecurs, campaignActOf } = await import('../../src/services/venture/hand.js');
    // Read from the act itself, however long R24 sized it.
    const ends = new Date(String((await campaignActOf(X))!.expiresAt).replace(' ', 'T') + 'Z').getTime();
    const soon = new Date(ends - (STOP_AHEAD_DAYS - 1) * 86_400_000);
    const r = await stopWhatRecurs(X, soon);
    expect(r.stopped).toBe(1);
    expect(await stopOf('sub_live')).toMatchObject({ asked_by: 'test_ended' });
  });

  it('when the owner stops the test, every subscription stops, and the stop act is not revoked with it', async () => {
    await aWeekIsPaid('in_last', 'sub_last', 'last@millwork.example');
    const { stopExperiment } = await import('../../src/services/venture/hand.js');
    await stopExperiment({ founderId: OWNER, experimentId: X, reason: 'enough' });
    expect(await stopOf('sub_last')).toMatchObject({ asked_by: 'test_ended' });
    expect((await stopOf('sub_last'))!.cancelled_at).not.toBeNull();
    const acts = await rowsOf(`SELECT action_type, revoked_at FROM proposed_acts WHERE experiment_id = ? AND decision = 'approved'`, [X]);
    const of = (t: string) => acts.find((a) => a.action_type === t)!;
    expect(of('stripe_create_payment_link').revoked_at, 'what takes things on is revoked').not.toBeNull();
    expect(of('stripe_update_subscription').revoked_at, 'the stop is not revoked with the test').toBeNull();
    expect(of('stripe_create_refund').revoked_at, 'nor is the refund').toBeNull();
  });
});

describe('and the page says it, or it is not published', () => {
  const weekly: PublicExperiment = {
    number: 4, slug: 'weekly-bids', path: '/experiments/weekly-bids', listed: true, title: 'Weekly bids brief',
    summary: 'A new shortlist of open public bids each week.', who: 'Small contractors.', what: 'A shortlist, every week.',
    limits: 'COMMBUYS only.', sources: 'COMMBUYS.', selection: 'Nobody was written to about this.', note: 'A small test.', sample: null, tool: null,
    freeToRead: null, status: 'testing', statusLabel: 'Testing', statusLine: 'Open', outcome: null, whereToGetIt: null,
    shape: 'product_page', clarification: null, recurring: true, payUrl: 'https://buy.stripe.com/test_w',
    price: { amountCents: 900, currency: 'USD', recurring: { interval: 'week' }, label: '$9 a week, until you cancel' },
    openedOn: '2026-10-04', closedOn: null, updatedOn: '2026-10-04', supersedes: null, successor: null, graduatedTo: null,
  } as unknown as PublicExperiment;
  let facts: Parameters<typeof renderExperiment>[0];
  beforeAll(async () => {
    const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
    const { workshopFacts } = await import('../../src/services/public-workshop/projection.js');
    facts = workshopFacts((await publicWorkshopOf(OWNER))!, {});
  });

  it('weekly until you cancel, how, and that nothing is charged after', () => {
    const html = renderExperiment(facts, weekly);
    expect(html).toMatch(/\$9 a week until you cancel/);
    expect(html).toMatch(/Cancel any time from the link in every email/);
    expect(html).toMatch(/nothing is charged after you cancel/);
    expect(html).toMatch(/Subscribe for \$9 a week/);
    expect(html).not.toMatch(/No subscription/i);
    expect(html, 'no machine-read price that would read as one-time').not.toMatch(/application\/ld\+json[^<]*"Offer"/);
    expect(renewalPromiseMissing(html, true)).toBeNull();
  });

  it('a page missing any of the three is refused, and a one-time page is still held to "no subscription"', () => {
    expect(renewalPromiseMissing('<p>$9 a week until you cancel.</p>', true)).toMatch(/how to cancel/);
    expect(renewalPromiseMissing('<p>$9, once.</p>', true)).toMatch(/every week until cancelled/);
    expect(renewalPromiseMissing('<p>$29, once.</p>', false)).toMatch(/no subscription/);
    expect(renewalPromiseMissing('<p>$29, once. No subscription, nothing renews.</p>', false)).toBeNull();
  });
});
