// =============================================================================
// A PAYMENT NOBODY TOLD US ABOUT.
//
// Every check this campaign has added asks whether a path was working. None of
// them can catch the case that actually costs a person their money: the
// endpoint was configured, the signature was right, the machinery passed every
// test, and one delivery was dropped. Somebody paid $29 and is waiting for
// something nobody knows they are owed.
//
// No verification made beforehand closes that. Asking does. Once a pass, for
// an owner with a live paid offer, Foundry reads the provider's own list and
// compares it with what it was told — and takes what it missed in through the
// same door a webhook would have used, so there is still exactly one way for a
// payment to become a fact.
//
// And the finding is recorded against the PATH, not just repaired. A payment
// that arrived only because we asked means the observation path was not
// carrying what it is for that day, and a later reading of the result depends
// on knowing that. Fixing the consequence and leaving the instrument looking
// healthy is the shape of the defect this whole campaign exists because of.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { seedUnheardPayment } from '../helpers/provider-stubs.js';
import { HANDS, OWNER, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;
let unheard = '';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  providers = seeded.providers!;
  await advanceDays(1);
  await runMorning(HANDS);
  app = await ownerApp();
  me = owner(app);
});

describe('the provider is asked what it knows, and what it knows becomes owed', () => {
  it('finds a payment no webhook ever delivered, and opens what the buyer is owed', async () => {
    const link = providers.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!;
    unheard = seedUnheardPayment(providers.state, {
      experimentId: X, paymentLinkId: link.id, amountCents: 2900, email: 'buyer@millwork.example',
    });
    // Nothing was delivered to the webhook: as far as Foundry knows, nobody paid.
    expect((await query(`SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?`, [X]))
      .rows[0] as Record<string, unknown>).toMatchObject({ n: 0 });

    await advanceDays(1);
    await runMorning(HANDS);

    const owed = (await query(
      `SELECT payment_ref, status FROM experiment_fulfilments WHERE experiment_id = ?`, [X]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(owed).toHaveLength(1);
    expect(owed[0].payment_ref).toBe(unheard);
  });

  it('takes it in through the same door a webhook would have used, so it cannot arrive twice', async () => {
    // The webhook finally turns up, late, for the payment already reconciled.
    const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
    const link = providers.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!;
    await intakeStripeSettlement({
      id: 'evt_late', type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: unheard, object: 'payment_intent', amount_received: 2900, currency: 'usd',
        metadata: { app: 'foundry', experiment_id: X, payment_link: link.id }, latest_charge: `ch_${unheard}` } },
    });
    const owed = (await query(
      `SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(Number(owed.n), 'one payment, one obligation, however many ways we hear of it').toBe(1);
  });

  it('records it against the path: the day the provider did not reach us is not a healthy day', async () => {
    const day = (await query(
      `SELECT worst_status, detail FROM public_channel_days
        WHERE founder_id = ? AND channel = 'payments' AND worst_status = 'needs_attention'
        ORDER BY day DESC LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown> | undefined;
    expect(day, 'a payment that reached us only because we asked is a fact about the path').toBeTruthy();
    expect(String(day!.detail)).toMatch(/only because it asked/);
  });

  it('the owner sees the obligation, not a note about reconciliation', async () => {
    const money = asText(await me.page('/foundry/money'));
    expect(money).toMatch(/Owed to buyers/);
  });
});

describe('a way to pay is not put where a stranger can reach it with nothing able to hear about it', () => {
  it('refuses to place a paid offer when the deployment cannot receive a payment event at all', async () => {
    const held = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const { ensureExposure } = await import('../../src/services/venture/hand.js');
      // The existing exposure short-circuits, so this is asked of the state a
      // fresh placement would meet: withdraw first, as a stop would.
      await query(`UPDATE experiment_exposures SET withdrawn_at = datetime('now') WHERE experiment_id = ? AND withdrawn_at IS NULL`, [X]);
      const r = await ensureExposure(X);
      expect('refused' in r && r.refused).toMatch(/nothing is configured to receive a payment event/);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = held;
    }
  });

  it('but a deployment that can receive one and never has is allowed to proceed, and says what is unproven', async () => {
    const { paymentObservationPath } = await import('../../src/services/venture/the-instrument.js');
    const reading = await paymentObservationPath();
    expect(reading.status, 'never having heard is not the same as being unable to hear').toBe('unknown');
    expect(reading.detail).toMatch(/none ever has been/);
    // Placement is asked again with the secret back in place. It still cannot
    // finish — the previous test withdrew the exposure and the provider keeps
    // one link per reference — and that is the point: whatever stops it, it is
    // not this gate. An unknown route is not a refusal; the pass asks the
    // provider hourly instead.
    const { ensureExposure } = await import('../../src/services/venture/hand.js');
    const r = await ensureExposure(X);
    expect('refused' in r ? r.refused : '').not.toMatch(/receive a payment event/);
  });

  it('a test-mode event never passes for a live one', async () => {
    await query(`INSERT INTO stripe_webhook_events (event_id, event_type, processed_at, livemode) VALUES (?,?,datetime('now'),0)`,
      ['evt_testmode', 'payment_intent.succeeded']);
    const { paymentObservationPath } = await import('../../src/services/venture/the-instrument.js');
    const test = await paymentObservationPath();
    expect(test.status).toBe('unknown');
    expect(test.detail).toMatch(/test mode; nothing has yet proved the live route/);
    await query(`INSERT INTO stripe_webhook_events (event_id, event_type, processed_at, livemode) VALUES (?,?,datetime('now'),1)`,
      ['evt_live', 'payment_intent.succeeded']);
    expect((await paymentObservationPath()).status).toBe('working');
  });
});
