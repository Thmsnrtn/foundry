// =============================================================================
// LAW (Roadmap 2027 R35): A CHECKOUT SOMEBODY OPENED AND LEFT IS ON RECORD.
//
// A payment link's only reach Foundry recorded was a payment or a declined
// card. Somebody who opened the checkout page and walked away left nothing,
// so a test placed on a link everybody looked at and nobody bought read "not
// reached" (R40), which is false, and the conversion question had no
// denominator. The provider keeps every session it opened at the link; one
// that expired unpaid is now taken in, by webhook or by the pass that already
// asks the provider what it knows, as a `checkout_started` on the exposure,
// through the same door, once by reference.
//
// Only expired sessions: an open one may still complete and a completed one is
// a payment, so counting either would count one buyer twice. A session whose
// card was already declined is that same beginning and shares its reference.
// A session at somebody else's link is not ours and is not recorded. Nothing
// is owed for a checkout that took no money.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { UNREACHED_SQL } from '../../src/services/founder/what-happened.js';
import { settlementFactsFromStripeEvent } from '../../src/services/venture/settlement-intake.js';
import { HANDS, advanceDays, runMorning, seedProductionShape } from '../helpers/world.js';

let X = '';
let linkId = '';
let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;

const unreached = async () => Number(((await query(`SELECT ${UNREACHED_SQL} AS u FROM venture_experiments e WHERE e.id = ?`, [X])).rows[0] as Record<string, unknown>).u) === 1;
const started = async () => (await query(
  `SELECT b.provider_event_ref AS ref FROM business_outcome_events b JOIN experiment_exposures x ON x.id = b.exposure_id
    WHERE x.experiment_id = ? AND b.kind = 'checkout_started' ORDER BY b.provider_event_ref`, [X])).rows.map((r) => String((r as Record<string, unknown>).ref));
const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id, object: 'checkout.session', status: 'expired', payment_status: 'unpaid', payment_link: linkId,
  amount_total: 2900, currency: 'usd', created: Math.floor(Date.now() / 1000), metadata: {}, customer_details: null, payment_intent: null, ...extra,
});

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  providers = seeded.providers!;
  await advanceDays(1);
  await runMorning(HANDS);
  linkId = providers.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!.id;
}, 180_000);

describe('a checkout opened and left is reach', () => {
  it('before anybody opens the checkout, the test is unreached', async () => {
    expect(await started()).toEqual([]);
    expect(await unreached()).toBe(true);
  });

  it('the pass that asks the provider takes in an expired session at our link, untagged, and the test is no longer unreached', async () => {
    // Somebody typed an address and left: reach, and still not a beginning to pay.
    providers.state.checkoutSessions.push(session('cs_left_1', { customer_details: { email: 'stranger@elsewhere.example' } }));
    // A session at somebody else's link, on the same account, is not ours.
    providers.state.checkoutSessions.push({ ...session('cs_not_ours'), payment_link: 'plink_somebody_else' });
    await advanceDays(1);
    await runMorning(HANDS);
    expect(await started()).toEqual(['cs_left_1']);
    expect(await unreached()).toBe(false);
    const { commercialMaturityOf } = await import('../../src/services/venture/commercial-maturity.js');
    expect((await commercialMaturityOf(X)).rung, 'opening a checkout is not beginning to pay').not.toBe('CE2');
  });

  it('asking again, or hearing it by webhook too, records it once', async () => {
    await advanceDays(1);
    await runMorning(HANDS);
    const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
    await intakeStripeSettlement({ id: 'evt_expired_1', type: 'checkout.session.expired', created: Math.floor(Date.now() / 1000), data: { object: session('cs_left_1') } });
    expect(await started()).toEqual(['cs_left_1']);
  });

  it('a session whose card was declined is the same beginning as the decline', async () => {
    const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
    await intakeStripeSettlement({ id: 'evt_declined', type: 'payment_intent.payment_failed', created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'pi_tried', object: 'payment_intent', amount: 2900, currency: 'usd', metadata: { app: 'foundry', experiment_id: X, payment_link: linkId }, last_payment_error: null } } });
    providers.state.checkoutSessions.push(session('cs_tried', { payment_intent: 'pi_tried' }));
    await advanceDays(1);
    await runMorning(HANDS);
    expect(await started()).toEqual(['cs_left_1', 'pi_tried:declined']);
  });

  it('nothing is owed for a checkout that took no money', async () => {
    const owed = (await query('SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(Number(owed.n)).toBe(0);
  });
});

describe('only a session that ended unpaid is read', () => {
  it('an open or a completed session is not a checkout left', () => {
    const at = (o: Record<string, unknown>) => settlementFactsFromStripeEvent({ type: 'checkout.session.expired', data: { object: o } });
    expect(at(session('cs_open', { status: 'open' }))).toEqual([]);
    expect(at(session('cs_paid', { status: 'complete', payment_status: 'paid' }))).toEqual([]);
    expect(at(session('cs_expired'))).toHaveLength(1);
    // Neither tagged nor at a link: nothing to resolve it by.
    expect(at(session('cs_nowhere', { payment_link: null }))).toEqual([]);
  });
});
