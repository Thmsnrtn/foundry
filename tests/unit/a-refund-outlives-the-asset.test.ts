// =============================================================================
// LAW (Roadmap 2027 R53): THE "NO TIME LIMIT" REFUND OUTLIVES THE ASSET.
//
// The public promise is a refund with no time limit, and the refund act the
// owner approves for a test says so: it stands for every purchase reported
// while it was valid, after it expires and after the test ends. What it did
// not survive was the asset being archived. A test's asset is archived once
// nobody is owed anything — a failed test thirty days after it ran — and the
// door then refused every effect on it, so a buyer who had their brief and
// asked for their money back a month later was told "someone will sort it
// out", and the owner was left to refund by hand in Stripe.
//
// Now an archived experimental asset may still return money, and only that:
// the refund its own approved act covers, through the same door, with every
// other check standing. Sending to that buyer, or anything else, is refused
// as before; a purchase no act covered is still the owner's.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '1'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, advanceDays, runMorning, seedProductionShape } from '../helpers/world.js';

let X = '';
let PRODUCT = '';
let PROVIDERS: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;
const PAID = 'pi_after_archive';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  PROVIDERS = seeded.providers!;
  await advanceDays(1);
  await runMorning(HANDS);
  const link = PROVIDERS.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!;
  PROVIDERS.state.buyers.set(PAID, 'buyer@example.com');
  PROVIDERS.state.charges.set(`ch_${PAID}`, { amount: 2900, amount_refunded: 0, metadata: { app: 'foundry', experiment_id: X } });
  const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
  await intakeStripeSettlement({
    id: 'evt_after_archive', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: PAID, object: 'payment_intent', amount_received: 2900, currency: 'usd',
      metadata: { app: 'foundry', experiment_id: X, payment_link: link.id }, latest_charge: `ch_${PAID}` } },
  });
  await runMorning(HANDS);
  // The provider confirms it arrived; nobody is owed anything.
  await query(`UPDATE experiment_fulfilments SET status = 'delivered', updated_at = datetime('now') WHERE payment_ref = ? AND status = 'sent'`, [PAID]);
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  const { retireExperimentalAsset } = await import('../../src/services/venture/asset.js');
  expect(await retireExperimentalAsset({ productId: PRODUCT, because: 'the test is over and nobody is owed anything' })).toBe(true);
});

describe('a month on, the buyer asks for their money back', () => {
  it('the asset is archived, and the refund still goes through, under the act the owner approved', async () => {
    const status = (await query('SELECT status FROM products WHERE id = ?', [PRODUCT])).rows[0] as Record<string, unknown>;
    expect(status.status).toBe('archived');
    const before = PROVIDERS.state.refunds.length;
    await query(`UPDATE experiment_fulfilments SET refund_requested_at = datetime('now'), updated_at = datetime('now') WHERE payment_ref = ?`, [PAID]);
    const f = (await query('SELECT id FROM experiment_fulfilments WHERE payment_ref = ?', [PAID])).rows[0] as Record<string, unknown>;
    const { refundFulfilment } = await import('../../src/services/venture/hand.js');
    const r = await refundFulfilment({ fulfilmentId: String(f.id), reason: 'buyer asked through the delivery link' });
    expect(r.refusedReason ?? null).toBeNull();
    expect(r.issued).toBe(true);
    expect(PROVIDERS.state.refunds.length).toBe(before + 1);
  });
});

describe('only money goes back through an archived asset', () => {
  it('anything else on it is refused at the door, as before', async () => {
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    const send = await checkKillSwitch(PRODUCT, 'send_email', null, { experimentAct: { experimentId: X, actId: 'act', kind: 'delivery' } });
    expect(send.blocked).toBe(true);
    expect(String(send.reason)).toMatch(/archived/);
  });
  it('and a refund with no act behind it, or under another kind of act, is refused too', async () => {
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    expect((await checkKillSwitch(PRODUCT, 'stripe_create_refund', null, {})).blocked).toBe(true);
    expect((await checkKillSwitch(PRODUCT, 'stripe_create_refund', null, { experimentAct: { experimentId: X, actId: 'a', kind: 'delivery' } })).blocked).toBe(true);
    // The tool name alone is not enough either: a refund act on another tool is not this.
    expect((await checkKillSwitch(PRODUCT, 'stripe_update_subscription', null, { experimentAct: { experimentId: X, actId: 'a', kind: 'refund' } })).blocked).toBe(true);
  });
});
