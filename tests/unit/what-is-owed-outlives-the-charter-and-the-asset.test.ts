// =============================================================================
// WHAT IS OWED OUTLIVES THE THINGS THAT MADE IT.
//
// A buyer's claim was already built to survive a stop, an expiry, a settlement
// and a provider outage. Two lifecycles were not in that list, and both end
// without anybody deciding anything: the CHARTER TERM the test was let in
// under, and the RETIREMENT of the asset it ran on.
//
//   the charter's days simply run out → a buyer pays after that → the asset
//   cannot be retired while they are owed → the morning delivers → and only
//   then does the asset stand down.
//
// The charter is not edited to make it end: it is sealed and the rows refuse
// it. Time passes, which is how a term actually ends.
//
// AND THE OTHER HALF, which is what the institution says when it CANNOT keep
// the promise: goods that have gone past their freshness limit and that
// nothing can re-pull. "The delivery goes out on the next pass" said every
// pass, for ever, is the promise-it-cannot-keep this institution refuses to
// make — the rule a withdrawn refund authority taught, met here a second time.
//
// Nobody real is written to; every provider is stubbed at the network edge.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, outreachOnly, runMorning, seedProductionShape } from '../helpers/world.js';

let X = '';
let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;
const PAID = 'pi_outlives_1';
const BUYER = 'buyer@millwork.example';
const rowsOf = async (sql: string, p: unknown[] = []) => (await query(sql, p)).rows as unknown as Array<Record<string, unknown>>;
const owed = async (ref: string) => (await rowsOf(
  `SELECT status, refund_ref FROM experiment_fulfilments WHERE payment_ref = ?`, [ref]))[0];
const assetOf = async () => (await rowsOf(
  `SELECT id, status, standing FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL`, [X]))[0];

const aBuyerPays = async (ref: string, email: string): Promise<void> => {
  const link = providers.state.paymentLinks.find((l) => l.metadata.experiment_id === X)!;
  providers.state.buyers.set(ref, email);
  const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
  await intakeStripeSettlement({
    id: `evt_${ref}`, type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: ref, object: 'payment_intent', amount_received: 2900, currency: 'usd',
      receipt_email: email,
      metadata: { app: 'foundry', experiment_id: X, payment_link: link.id }, latest_charge: `ch_${ref}` } },
  });
};

beforeAll(async () => {
  const seeded = await seedProductionShape({ charter: true, settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  providers = seeded.providers!;
  await advanceDays(1);
  await runMorning(HANDS);
  // A SHORT TERM, SO IT ENDS BEFORE ANYTHING ELSE DOES. The acts the owner
  // approved with the test live twenty-one days and the goods stay fresh for
  // seven, so a thirty-day charter cannot be the first thing to end. He may
  // sign a shorter one, and this is the only way to ask the question this file
  // is about without also asking the ones already answered elsewhere.
  const { signCharter } = await import('../../src/services/institution/charter.js');
  await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3,
    cognitionCentsPerDay: 300, days: 2, publicVoice: 'Apex Micro', statement: 'A short term, deliberately.' });
});

describe('a purchase that arrives after the term has ended', () => {
  it('the charter term runs out on its own', async () => {
    const { liveCharter } = await import('../../src/services/institution/charter.js');
    expect(await liveCharter(OWNER), 'the fixture must actually have a charter').not.toBeNull();
    await advanceDays(3);
    await runMorning(HANDS);
    expect(await liveCharter(OWNER), 'the term has ended, and nobody decided it').toBeNull();
  });

  it('a buyer pays anyway, and the asset may not be retired while they are owed', async () => {
    await aBuyerPays(PAID, BUYER);
    expect(String((await owed(PAID)).status), 'on the books, undelivered').not.toBe('delivered');
    const asset = await assetOf();
    expect(asset, 'the test has an asset').toBeTruthy();
    // STANDING THE ASSET DOWN IS REFUSED WHILE SOMEBODY IS OWED. A delivery
    // and a refund both run under the asset; archiving it now would leave the
    // obligation with nothing to carry it.
    const { retireExperimentalAsset } = await import('../../src/services/venture/asset.js');
    expect(await retireExperimentalAsset({ productId: String(asset.id), because: 'the term ended' }),
      'an asset somebody is owed something under does not stand down').toBe(false);
    expect(String((await assetOf()).status)).toBe('active');
  });

  it('and the morning delivers what they bought', async () => {
    const before = outreachOnly(providers.state.sends).length;
    // Two mornings: one sends it, the next reads the provider's word for it.
    for (let i = 0; i < 2; i += 1) { await advanceDays(1); await runMorning(HANDS); }
    expect(String((await owed(PAID)).status),
      'a buyer is owed the thing whatever happened to the charter').toBe('delivered');
    const sent = outreachOnly(providers.state.sends).slice(before);
    expect(sent.some((m) => m.to.includes(BUYER)), 'the delivery actually went to the buyer').toBe(true);
    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    expect((await obligationsFor(OWNER)).find((o) => o.paymentRef === PAID)).toBeUndefined();
  });

  it('and the two refusals to stand it down are not the same refusal', async () => {
    const asset = await assetOf();
    const { retireExperimentalAsset } = await import('../../src/services/venture/asset.js');
    // WITH THE LAST BUYER SQUARE, THE OBLIGATION NO LONGER STANDS IN THE WAY —
    // and the asset still does not stand down, for a different and permanent
    // reason: this test runs on the owner's own earned company, and archiving
    // that is not something this act does at any time, to anybody.
    expect(String(asset.standing), 'the test ran on his earned Workshop').toBe('earned');
    expect(await retireExperimentalAsset({ productId: String(asset.id), because: 'the term ended' }),
      'an earned company is never archived by the act that retires a test\'s asset').toBe(false);
    expect(String((await assetOf()).status), 'and it is left exactly as it was').toBe('active');
    // The distinction matters because the first refusal must lift when the
    // buyer is square and the second must not. Told apart by what they are
    // about, and an owner reading the page is not shown one as the other.
    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    expect((await obligationsFor(OWNER)).some((o) => o.paymentRef === PAID),
      'nothing about this buyer is open any more').toBe(false);
  });
});

describe('and what cannot go out says so, rather than promising for ever', () => {
  const STUCK = 'pi_stuck_1';
  it('a buyer whose goods have gone stale, on a test nothing can re-pull for', async () => {
    // The goods age past their freshness limit. This test's offer shape is not
    // one the hands made, so no steward pass will ever re-pull it: the quality
    // gate will refuse this delivery on every pass from now until somebody
    // acts.
    await advanceDays(12);
    await aBuyerPays(STUCK, 'second@millwork.example');
    const { materialOf, checkDeliverableQuality } = await import('../../src/services/venture/hand.js');
    const goods = (await materialOf(X, 'deliverable'))!;
    expect(checkDeliverableQuality(goods, new Date()).ok,
      `the goods must actually be stale or this proves nothing (pulled ${String(goods.pulledAt)})`).toBe(false);
    const shape = await materialOf(X, 'offer_shape');
    expect((shape?.body ?? '').includes('"kind":"data_brief"'),
      'and must not be re-pullable, or the steward would simply fix it').toBe(false);

    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    const stuck = (await obligationsFor(OWNER)).find((o) => o.paymentRef === STUCK)!;
    expect(stuck.sentence, `it does not say the delivery goes out on the next pass (state=${stuck.state}, action=${stuck.action})`)
      .not.toMatch(/goes out on the next pass/);
    expect(stuck.sentence).toMatch(/the delivery is refused/);
    expect(stuck.action).toBe('deliver_or_refund_yourself');
    expect(stuck.asksHim).toMatch(/send them what they bought, or refund them/);
  });
});
