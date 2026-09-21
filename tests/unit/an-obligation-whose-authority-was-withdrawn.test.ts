// =============================================================================
// AN OBLIGATION WHOSE AUTHORITY THE OWNER TOOK BACK.
//
// The purchase pathway was built to make what a buyer is owed outlive the
// things that used to lose it: a stop, an expiry, a settlement, an outage. One
// case was not in that list. The owner may WITHDRAW the act that authorises a
// refund while a refund is owed — which is his right, and the institution must
// not work around it — and until now the obligation went on reporting "I try
// again on the next pass" about something that could never go through.
//
// A promise the institution cannot keep is worse than a refusal it explains.
// The obligation reads whether its authority still stands, says at once that
// it will not try again, and names the two ways out: refund it in Stripe, or
// approve the refund again.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
// Money tools ON, so the scenario is about the authority the owner took back
// and not about the switch that stops Foundry moving money at all. Those are
// two different refusals and an obligation must not confuse them.
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
const PAID = 'pi_withdrawn_1';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  await advanceDays(1);
  await runMorning(HANDS);
  const link = seeded.providers!.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!;
  // A purchase, through the door a webhook uses.
  const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
  await intakeStripeSettlement({
    id: 'evt_withdrawn', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: PAID, object: 'payment_intent', amount_received: 2900, currency: 'usd',
      metadata: { app: 'foundry', experiment_id: X, payment_link: link.id }, latest_charge: `ch_${PAID}` } },
  });
  // The buyer asks for their money back through the signed link.
  await query(
    `UPDATE experiment_fulfilments SET refund_requested_at = datetime('now') WHERE payment_ref = ?`, [PAID]);
  app = await ownerApp();
  me = owner(app);
});

describe('what is owed does not pretend an authority that is gone', () => {
  it('while the act stands, the refund is Foundry\'s to keep trying', async () => {
    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    const owed = (await obligationsFor(OWNER)).find((o) => o.paymentRef === PAID)!;
    expect(owed.state).toBe('refund_requested');
    expect(owed.action).toBe('nothing');
    expect(owed.sentence).toMatch(/I try again on the next pass/);
  });

  it('withdrawn, it says at once that it will not try again, and what the two ways out are', async () => {
    const act = (await query(
      `SELECT id FROM proposed_acts WHERE experiment_id = ? AND action_type = 'stripe_create_refund'
        ORDER BY rowid DESC LIMIT 1`, [X])).rows[0] as Record<string, unknown>;
    await query(`UPDATE proposed_acts SET revoked_at = datetime('now') WHERE id = ?`, [String(act.id)]);

    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    const owed = (await obligationsFor(OWNER)).find((o) => o.paymentRef === PAID)!;
    // NOT "nothing", and not after a day of saying it would try: at once.
    expect(owed.action).toBe('refund_yourself');
    expect(owed.sentence).toMatch(/You withdrew the authority to refund this test, so I will not try again/);
    expect(owed.sentence).not.toMatch(/I try again on the next pass/);
    expect(owed.asksHim).toMatch(/Refund it yourself in Stripe/);
    expect(owed.asksHim).toMatch(/or approve the refund again/);
  });

  it('it is still owed, still his, and still on the surfaces that carry what is owed', async () => {
    const { owesAnybody } = await import('../../src/services/venture/obligations.js');
    expect(await owesAnybody(X), 'withdrawing the authority does not discharge the debt').toBe(true);
    const money = asText(await me.page('/foundry/money'));
    expect(money).toContain('Owed to buyers');
    expect(money).toContain(PAID);
  });

  it('and Foundry does not work around the withdrawal', async () => {
    const f = (await query(`SELECT id FROM experiment_fulfilments WHERE payment_ref = ?`, [PAID]))
      .rows[0] as Record<string, unknown>;
    const { refundFulfilment } = await import('../../src/services/venture/hand.js');
    const r = await refundFulfilment({ fulfilmentId: String(f.id), reason: 'the buyer asked' });
    expect(r.issued, 'an act he took back is an act he took back').toBe(false);
    expect(r.refusedReason).toBeTruthy();
  });
});
