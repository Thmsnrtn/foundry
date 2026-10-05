// =============================================================================
// LAW (Roadmap 2027 R31): A PAID DELIVERY NEVER STALLS SILENTLY.
//
// A buyer's delivery is planned once, keyed on the payment, and the plan was
// returned whatever had become of it. When the door refused it once (a budget
// cap for a moment, the kill switch, a pass already in flight) or the send's
// outcome was unknown, or the process died mid-send, the pass skipped it with
// no word on every later pass, and every surface went on saying "the delivery
// goes out on the next pass" — to the owner, to the absence check, to the
// weekly sets — about something no pass would ever do again.
//
// Now: a delivery refused before it went out is tried again on the next pass;
// one whose outcome is unknown is tried again after its reconcile time under
// the same idempotency key, so the provider cannot send it twice; one that
// went out and was never recorded is recorded as sent. And a paid delivery
// that has not gone out a day after the purchase is the owner's to know about,
// with the last refusal named, and no longer a promise about the next pass.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, runMorning, seedProductionShape } from '../helpers/world.js';

let X = '';
let LINK = '';
let PROVIDERS: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;

type Row = Record<string, unknown>;
const one = async (sql: string, p: unknown[]) => (await query(sql, p)).rows[0] as Row | undefined;

async function buys(pi: string): Promise<void> {
  PROVIDERS.state.buyers.set(pi, `${pi}@buyer.example`);
  const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
  await intakeStripeSettlement({
    id: `evt_${pi}`, type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: pi, object: 'payment_intent', amount_received: 2900, currency: 'usd',
      metadata: { app: 'foundry', experiment_id: X, payment_link: LINK }, latest_charge: `ch_${pi}` } },
  });
}
const fulfilment = (pi: string) => one('SELECT id, status FROM experiment_fulfilments WHERE payment_ref = ?', [pi]);
const deliveryOf = (pi: string) => one(`SELECT o.id, o.status FROM outbound_actions o JOIN experiment_fulfilments f ON f.id = o.fulfilment_id
  WHERE f.payment_ref = ? AND o.experiment_act = 'delivery'`, [pi]);
const sendsTo = async (pi: string) => Number((await one(`SELECT COUNT(*) AS n FROM outbound_actions o JOIN experiment_fulfilments f ON f.id = o.fulfilment_id
  WHERE f.payment_ref = ? AND o.experiment_act = 'delivery' AND o.status = 'executed'`, [pi]))?.n ?? 0);
const obligation = async (pi: string) => {
  const { obligationsFor } = await import('../../src/services/venture/obligations.js');
  return (await obligationsFor(OWNER)).find((o) => o.paymentRef === pi)!;
};
/** A delivery planned and refused at the door before anything went out, as executeAction records it. */
async function refusedAtTheDoor(pi: string, reason: string): Promise<void> {
  const { planDelivery } = await import('../../src/services/venture/hand.js');
  const f = await fulfilment(pi);
  const plan = await planDelivery({ experimentId: X, fulfilmentId: String(f!.id) });
  await query(`UPDATE outbound_actions SET status = 'rejected', effect_certainty = 'not_attempted', result_json = ? WHERE id = ?`,
    [JSON.stringify({ phase: 'budget', reason }), plan.id]);
}

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  await advanceDays(1);
  await runMorning(HANDS);
  PROVIDERS = seeded.providers!;
  LINK = seeded.providers!.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!.id;
});

describe('a delivery refused before it went out is tried again', () => {
  it('says the attempt was refused and why, and that it is tried again — not that it simply goes out', async () => {
    await buys('pi_refused_once');
    await refusedAtTheDoor('pi_refused_once', 'the day\'s sending budget is spent');
    const o = await obligation('pi_refused_once');
    expect(o.state).toBe('owed');
    expect(o.sentence).toMatch(/the last attempt was refused \(budget: the day's sending budget is spent\)/);
    expect(o.sentence).toMatch(/I try again on the next pass/);
    expect(o.asksHim).toBeNull();
  });

  it('the next pass sends it, once', async () => {
    await runMorning(HANDS);
    expect((await fulfilment('pi_refused_once'))!.status).toBe('sent');
    expect(await sendsTo('pi_refused_once')).toBe(1);
    await runMorning(HANDS);
    expect(await sendsTo('pi_refused_once')).toBe(1);
  });
});

describe('a send that went out and was never recorded is recorded, not sent again', () => {
  it('an executed delivery behind an owed purchase marks it sent', async () => {
    await buys('pi_unrecorded');
    const { planDelivery, executeAction } = await import('../../src/services/venture/hand.js');
    const plan = await planDelivery({ experimentId: X, fulfilmentId: String((await fulfilment('pi_unrecorded'))!.id) });
    expect((await executeAction(plan.id)).dispatched).toBe(true);
    // The process stopped before the purchase was marked: it still reads owed.
    expect((await fulfilment('pi_unrecorded'))!.status).toBe('owed');
    await runMorning(HANDS);
    expect((await fulfilment('pi_unrecorded'))!.status).toBe('sent');
    expect(await sendsTo('pi_unrecorded')).toBe(1);
  });
});

describe('a send cut off mid-flight is not left executing for ever', () => {
  it('an hour on, it is treated as an unknown outcome and tried again under the same key', async () => {
    await buys('pi_cut_off');
    const { planDelivery } = await import('../../src/services/venture/hand.js');
    const plan = await planDelivery({ experimentId: X, fulfilmentId: String((await fulfilment('pi_cut_off'))!.id) });
    await query(`UPDATE outbound_actions SET status = 'executing', created_at = datetime('now', '-2 hours') WHERE id = ?`, [plan.id]);
    await runMorning(HANDS);
    expect((await deliveryOf('pi_cut_off'))!.status).toBe('executed');
    expect((await fulfilment('pi_cut_off'))!.status).toBe('sent');
  });
});

describe('a day late, it is his', () => {
  it('names the lateness and the last refusal, asks him, and stops promising the next pass', async () => {
    await buys('pi_late');
    await refusedAtTheDoor('pi_late', 'sending is paused');
    // Two days pass and no pass runs: the world ages, nothing goes out.
    await advanceDays(2);
    const o = await obligation('pi_late');
    expect(o.state).toBe('owed');
    expect(o.action).toBe('deliver_or_refund_yourself');
    expect(o.sentence).toMatch(/has not gone out in 48 hours/);
    expect(o.sentence).toMatch(/sending is paused/);
    expect(o.sentence).not.toMatch(/goes out on the next pass/);
    expect(o.asksHim).toMatch(/late/);
    expect(o.asksHim).toMatch(/refund them in Stripe, which closes it, or clear what is refusing it and I send it on the next pass/);
  });

  it('reaches every surface that reads what is asked of him', async () => {
    const { handExceptions } = await import('../../src/services/venture/hand.js');
    expect((await handExceptions(X)).join(' ')).toMatch(/has not gone out in 48 hours/);
    const { buyersWaitingOnHim } = await import('../../src/services/venture/obligations.js');
    expect((await buyersWaitingOnHim(OWNER)).map((o) => o.sentence).join(' ')).toMatch(/pi_late/);
  });

  it('a purchase owed for less than a day, with nothing refused, still just goes out', async () => {
    await buys('pi_fresh');
    const o = await obligation('pi_fresh');
    expect(o.action).toBe('nothing');
    expect(o.asksHim).toBeNull();
    expect(o.sentence).toMatch(/the delivery goes out on the next pass/);
  });
});
