process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { setPolicy } from '../../src/services/economy/ledger.js';
import {
  distributableSurplus, moneyHeld, obligationsOutstanding, refundExposure,
  taxReserve, totalContribution, unitContribution,
} from '../../src/services/economy/projection.js';
import { intakeStripeEconomics } from '../../src/services/economy/stripe-economics.js';

// =============================================================================
// THE FIRST REAL PAYMENT SHOULD NOT REQUIRE ANOTHER ARCHITECTURE PROJECT.
//
// Every stage of the economic path exists and each has its own tests. What none
// of them proved is that a payment ARRIVING AT THE OUTSIDE EDGE reaches the
// far end on its own — that the joints hold, in order, without anybody wiring
// something up on the day money first appears.
//
// So this walks one: a provider event shaped the way Stripe really shapes one,
// in at the intake the webhook actually calls, and out at the figure the owner
// would be told is his.
//
//   provider event → canonical economic event → the sale it belongs to
//     → what is held → what is owed → refund exposure → tax reserve
//     → contribution → distributable surplus
//
// NOTHING HERE IS PRODUCTION EVIDENCE, and it is not meant to be. It runs in
// memory, the money is imaginary, and no figure it produces is quoted anywhere.
// Commercial maturity is a thing reality supplies; this is the readiness that
// lets reality supply it. The production ledger stays empty until somebody
// actually pays, and that emptiness is the honest state.
//
// WHAT WOULD MAKE THIS TEST FAIL is the thing worth catching: a joint that
// quietly stopped connecting — an intake that no longer recognises the event
// shape, a link that cannot find the sale, a projection that does not see the
// row. Each of those would otherwise be discovered on the first real payment,
// which is the worst day to discover it.
// =============================================================================

let OWNER = '';
let EXPERIMENT = '';
let FULFILMENT = '';
let PAYMENT_REF = '';
let CHARGE_REF = '';

const PRICE_CENTS = 2900;

/** A settled sale of ours, built the way the product builds one. */
async function aSaleOf(amountCents: number): Promise<void> {
  const id = nanoid();
  const oppId = `opp_${id}`, unkId = `unk_${id}`, expoId = nanoid(), eventId = nanoid();
  EXPERIMENT = nanoid();
  FULFILMENT = id;
  PAYMENT_REF = `pi_${id}`;
  CHARGE_REF = `ch_${id}`;

  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({
    founderId: OWNER, statement: 'Shops that build the thing', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);

  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it,
       the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'a brief worth paying for','shops','scattered notices','somebody pays','nobody pays','[]','real')`,
    [oppId, m.id, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,'will anyone pay',1,'write once')`, [unkId, OWNER, oppId]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do,
       what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,'sell a brief','someone pays','nobody pays',0,'real')`,
    [EXPERIMENT, OWNER, oppId, unkId]);
  await query(
    `UPDATE venture_experiments SET decision='approved', decided_at=datetime('now'), decided_by='owner'
      WHERE id=?`, [EXPERIMENT]);
  await query(
    `INSERT INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref,
       evidence_mode, placed_by)
     VALUES (?,?,?,'stripe',?,'real','test fixture')`, [expoId, OWNER, EXPERIMENT, `plink_${id}`]);
  await query(
    `INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents,
       observed_at, provider, provider_event_ref, evidence_mode)
     VALUES (?,?,?,'payment',?,datetime('now'),'stripe',?,'real')`,
    [eventId, OWNER, expoId, amountCents, PAYMENT_REF]);
  await query(
    `INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id,
       payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency, status)
     VALUES (?,?,?,?,?,'stripe',?,?,?,'usd','owed')`,
    [id, OWNER, EXPERIMENT, expoId, eventId, PAYMENT_REF, CHARGE_REF, amountCents]);
}

/** A charge event shaped the way Stripe shapes one, tagged as ours. */
const chargeEvent = (amountCents: number): Record<string, unknown> => ({
  id: `evt_${nanoid()}`,
  type: 'charge.succeeded',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      object: 'charge', id: CHARGE_REF, amount: amountCents, currency: 'usd',
      payment_intent: PAYMENT_REF,
      // No balance_transaction: the fee is a separate read, and its absence is
      // the honest "not known" this path must preserve rather than zero.
      metadata: { app: 'foundry', experiment_id: EXPERIMENT },
    },
  },
});

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  OWNER = `pay_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [OWNER, `clerk_${OWNER}`, `${OWNER}@example.com`]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [`prod_${OWNER}`, 'Apex Micro', OWNER]);
  await aSaleOf(PRICE_CENTS);
});

describe('one payment, from the provider edge to the owner figure', () => {
  it('turns a provider event into a canonical economic event attached to the sale', async () => {
    const out = await intakeStripeEconomics(chargeEvent(PRICE_CENTS));
    expect(out.unread, 'the charge could not be matched to a sale of ours').toEqual([]);
    expect(out.recorded.map((r) => r.kind)).toContain('charge');

    const row = (await query(
      `SELECT kind, amount_cents, fulfilment_id, source_event_id, claim_quality
         FROM economic_events WHERE founder_id = ?`, [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(row.amount_cents)).toBe(PRICE_CENTS);
    // ATTACHED, not free-floating: it points at the sale and at the event that
    // caused it, which is what makes every figure downstream traceable.
    expect(String(row.fulfilment_id)).toBe(FULFILMENT);
    expect(row.source_event_id).not.toBeNull();
    expect(String(row.claim_quality)).toBe('measured');
  });

  it('reaches every figure the owner is shown, in order', async () => {
    await intakeStripeEconomics(chargeEvent(PRICE_CENTS));

    // HELD — the money exists and has not been taken out.
    expect((await moneyHeld(OWNER)).cents).toBe(PRICE_CENTS);

    // OWED — paid for and not yet delivered is not surplus.
    expect((await obligationsOutstanding(OWNER)).cents).toBe(PRICE_CENTS);

    // NOT YET REFUNDABLE, and that is the right answer rather than a gap in
    // the walk. Money paid for something undelivered is OWED; money paid for
    // something delivered is REFUNDABLE. It is never both, and the handover
    // between them is asserted below.
    expect((await refundExposure(OWNER)).cents).toBe(0);

    // CONTRIBUTION — not known, because the provider fee has not been read.
    // The gap must travel rather than be drawn as zero.
    const unit = await unitContribution(OWNER, FULFILMENT);
    expect(unit.charged.cents).toBe(PRICE_CENTS);
    expect(unit.providerFee.cents, 'a fee nobody read must not become zero').toBeNull();
    expect(unit.contribution.cents).toBeNull();
    expect((await totalContribution(OWNER)).cents).toBeNull();

    // AND THE FIGURE HE WOULD BE TOLD IS HIS — withheld, for a stated reason.
    const surplus = await distributableSurplus(OWNER);
    expect(surplus.figure.cents).toBeNull();
    expect(surplus.sentence.length).toBeGreaterThan(20);
  });

  it('moves what is owed into what is refundable the moment it is delivered', async () => {
    // THE HANDOVER, which is where a total could silently double-count or drop
    // the money altogether. Before delivery it is owed and not refundable;
    // after, refundable and not owed. The sum of the two never changes.
    await intakeStripeEconomics(chargeEvent(PRICE_CENTS));
    expect((await obligationsOutstanding(OWNER)).cents).toBe(PRICE_CENTS);
    expect((await refundExposure(OWNER)).cents).toBe(0);

    await query("UPDATE experiment_fulfilments SET status='delivered' WHERE id=?", [FULFILMENT]);

    expect((await obligationsOutstanding(OWNER)).cents).toBe(0);
    expect((await refundExposure(OWNER)).cents).toBe(PRICE_CENTS);
    // And the money is still held either way — delivering it does not bank it.
    expect((await moneyHeld(OWNER)).cents).toBe(PRICE_CENTS);
  });

  it('holds back tax only once an assumption exists, and says whose it is', async () => {
    await intakeStripeEconomics(chargeEvent(PRICE_CENTS));
    expect((await taxReserve(OWNER)).cents, 'no assumption, no reserve').toBeNull();

    await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 2500, basis: 'contribution',
      source: 'the owner said so', because: 'a quarter of what is left, set aside',
      setBy: `founder:${OWNER}`,
    });
    const reserve = await taxReserve(OWNER);
    // Still null: the reserve rests on contribution, and contribution is not
    // known while the fee is unread. An estimate on top of an unknown is not an
    // estimate, it is a guess.
    expect(reserve.cents).toBeNull();
    expect(reserve.policy?.rateBps).toBe(2500);
  });

  it('records the same provider fact once, however many times it is delivered', async () => {
    // Stripe retries. The far end must not count a payment twice.
    const event = chargeEvent(PRICE_CENTS);
    await intakeStripeEconomics(event);
    const again = await intakeStripeEconomics(event);
    expect(again.recorded.every((r) => r.duplicate)).toBe(true);
    expect((await moneyHeld(OWNER)).cents).toBe(PRICE_CENTS);
  });

  it('will not take somebody else\'s money for ours', async () => {
    // The Stripe account is shared. An event tagged for another app, or tagged
    // for no experiment at all, is not this institution's money.
    const foreign = chargeEvent(PRICE_CENTS);
    (((foreign.data as Record<string, unknown>).object as Record<string, unknown>)
      .metadata as Record<string, string>) = { app: 'acreos', experiment_id: EXPERIMENT };
    const out = await intakeStripeEconomics(foreign);
    expect(out.recorded).toEqual([]);
    expect((await moneyHeld(OWNER)).cents).toBe(0);
  });

  it('says so, rather than guessing, when a charge matches no sale of ours', async () => {
    const orphan = chargeEvent(PRICE_CENTS);
    const obj = (orphan.data as Record<string, unknown>).object as Record<string, unknown>;
    obj.id = 'ch_nothing_here';
    obj.payment_intent = 'pi_nothing_here';
    const out = await intakeStripeEconomics(orphan);
    expect(out.recorded).toEqual([]);
    expect(out.unread[0]?.reason).toContain('no settled sale of ours');
  });
});
