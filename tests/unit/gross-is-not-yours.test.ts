process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { record, setPolicy, policyInForce } from '../../src/services/economy/ledger.js';
import {
  distributableSurplus, grossCharged, ledgerEntries, moneyBanked, moneyHeld,
  obligationsOutstanding, refundExposure, runningCost, taxReserve, totalContribution,
  unitContribution,
} from '../../src/services/economy/projection.js';
import { moneyFactsFromStripeEvent } from '../../src/services/economy/stripe-economics.js';

// =============================================================================
// GROSS IS NOT YOURS.
//
// A $29 payment is recorded and the institution used to stop there. It is not
// $29 of anything the owner can take: Stripe takes a fee at the moment of the
// charge, the work may be owed and undelivered, the refunds page promises the
// money back with "no form, no time limit", and no tax has been set aside.
//
// These tests hold the three things that make that subtraction trustworthy:
//
//   1. NOTHING IS INVENTED. A fee that was never read produces "not known",
//      never zero, and the not-known spreads: a unit with no fee has no
//      contribution, and a surplus with no contribution has no number.
//   2. AN ESTIMATE SAYS SO. The tax reserve is the only estimate, it cannot
//      exist without the assumption that produced it, and the moment it enters
//      the sum the sum stops calling itself measured.
//   3. THE LEDGER DOES NOT CHANGE ITS MIND. Append-only in the schema.
//
// And one fact about this deployment specifically: the Stripe account is shared
// with the land sales and AcreOS, so a payout from it is not this institution's
// money and nothing here will read one as cash.
// =============================================================================

// A FRESH OWNER PER TEST, RATHER THAN A CLEAN TABLE.
//
// The ledger refuses DELETE — it is append-only in the schema, which is the
// whole point of it — so a `beforeEach` that truncates cannot work here, and a
// fulfilment cannot be deleted either once a ledger row points at it. Each case
// gets its own institution instead, which is closer to what these projections
// actually are: everything is scoped by founder.
let OWNER = '';
let PRODUCT = '';
let MANDATE = '';

async function fulfilment(amountCents: number, status: string): Promise<string> {
  const id = nanoid();
  const expId = nanoid();
  const oppId = `opp_${id}`;
  const unkId = `unk_${id}`;
  const expoId = nanoid();
  const eventId = nanoid();
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'a brief worth paying for','shops','scattered notices','somebody pays','nobody pays','[]','real')`,
    [oppId, MANDATE, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,'will anyone pay',1,'write once')`, [unkId, OWNER, oppId]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,'real')`,
    [expId, OWNER, oppId, unkId, 'sell a brief', 'someone pays', 'nobody pays', 0]);
  // An exposure may only be placed for a test the owner approved, which is the
  // rule that keeps an unapproved idea from reaching the world.
  await query(
    `UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'), decided_by = 'owner' WHERE id = ?`,
    [expId]);
  await query(
    `INSERT INTO experiment_exposures
       (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by)
     VALUES (?,?,?,'stripe',?,'real','test fixture')`,
    [expoId, OWNER, expId, `plink_${id}`]);
  await query(
    `INSERT INTO business_outcome_events
       (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
     VALUES (?,?,?,'payment',?,datetime('now'),'stripe',?,'real')`,
    [eventId, OWNER, expoId, amountCents, `pi_${id}`]);
  await query(
    `INSERT INTO experiment_fulfilments
       (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency, status)
     VALUES (?,?,?,?,?,'stripe',?,?,?,'usd','owed')`,
    [id, OWNER, expId, expoId, eventId, `pi_${id}`, `ch_${id}`, amountCents]);
  // A fulfilment arrives OWED and is moved forward, never inserted settled:
  // what is owed to a buyer begins the moment they pay, and the schema says so.
  if (status !== 'owed') {
    await query(`UPDATE experiment_fulfilments SET status = ? WHERE id = ?`, [status, id]);
  }
  return id;
}

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  OWNER = `econ_${nanoid(8)}`;
  PRODUCT = `prod_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [OWNER, `clerk_${OWNER}`, `${OWNER}@example.com`]);
  await query('INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,\'active\')',
    [PRODUCT, 'Apex Micro', OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Shops that build the thing', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  MANDATE = m.id;
});

describe('the ledger only records what somebody said', () => {
  it('refuses to be edited or deleted once written', async () => {
    const f = await fulfilment(2900, 'delivered');
    const r = await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    await expect(query('UPDATE economic_events SET amount_cents = 1 WHERE id = ?', [r.id]))
      .rejects.toThrow(/append_only/);
    await expect(query('DELETE FROM economic_events WHERE id = ?', [r.id]))
      .rejects.toThrow(/append_only/);
  });

  it('records the same provider fact once, however many times it is delivered', async () => {
    const f = await fulfilment(2900, 'delivered');
    const write = () => record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: 'txn_dup', fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    const first = await write();
    const second = await write();
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('will not let an estimate exist without the assumption behind it', async () => {
    const f = await fulfilment(2900, 'delivered');
    await expect(record({
      founderId: OWNER, kind: 'unit_cost', amountCents: 50, occurredAt: new Date(),
      provider: 'internal', providerRef: 'guess_1', fulfilmentId: f,
      claimQuality: 'estimated', evidenceMode: 'real', because: 'a guess',
    })).rejects.toThrow(/estimate_needs_policy/);
  });

  it('will not let a measured figure quietly rest on one', async () => {
    const f = await fulfilment(2900, 'delivered');
    const policyId = await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 3000, basis: 'contribution',
      source: 'what my accountant said last year', because: 'so tax is held back', setBy: 'owner',
    });
    await expect(record({
      founderId: OWNER, kind: 'unit_cost', amountCents: 50, occurredAt: new Date(),
      provider: 'internal', providerRef: 'laundered_1', fulfilmentId: f,
      claimQuality: 'measured', policyId, evidenceMode: 'real', because: 'dressed as measured',
    })).rejects.toThrow(/measured_cannot_assume/);
  });
});

describe('what is not known is never drawn as zero', () => {
  it('has no contribution for a sale whose provider fee was never read', async () => {
    const f = await fulfilment(2900, 'delivered');
    const u = await unitContribution(OWNER, f);
    expect(u.charged.cents).toBe(2900);
    expect(u.providerFee.cents).toBeNull();
    expect(u.contribution.cents).toBeNull();
    expect(u.contribution.quality).toBe('unavailable');
    expect(u.contribution.because).toMatch(/provider fee/i);
  });

  it('has one the moment the provider says what it took', async () => {
    const f = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    const u = await unitContribution(OWNER, f);
    expect(u.contribution.cents).toBe(2900 - 114);
    expect(u.contribution.quality).toBe('measured');
  });

  it('spreads the not-known upward rather than totalling around it', async () => {
    const known = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${known}`, fulfilmentId: known,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    await fulfilment(4900, 'delivered'); // fee never read
    const total = await totalContribution(OWNER);
    expect(total.cents).toBeNull();
    expect(total.because).toMatch(/1 of 2/);
  });
});

describe('the one estimate says it is one', () => {
  it('holds back nothing, and knows it, when nothing has been earned', async () => {
    const t = await taxReserve(OWNER);
    expect(t.cents).toBe(0);
    expect(t.quality).toBe('measured');
    expect(t.because).toMatch(/nothing has been earned/i);
    expect(t.policy).toBeNull();
  });

  it('refuses to name a figure once money has come in and nothing has been assumed', async () => {
    const f = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    const t = await taxReserve(OWNER);
    expect(t.cents).toBeNull();
    expect(t.quality).toBe('unavailable');
    expect(t.because).toMatch(/no tax assumption/i);
    expect(t.policy).toBeNull();
  });

  it('names the assumption it used, in the owner\'s own words', async () => {
    const f = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 3000, basis: 'contribution',
      source: 'a third of margin, which is what I was told to keep back',
      because: 'so tax is held back', setBy: 'owner',
    });
    const t = await taxReserve(OWNER);
    expect(t.quality).toBe('estimated');
    expect(t.cents).toBe(Math.round((2900 - 114) * 0.3));
    expect(t.because).toMatch(/a third of margin/);
  });

  it('turns the whole sum into an estimate the moment it enters it', async () => {
    const f = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 3000, basis: 'contribution',
      source: 'a third of margin', because: 'held back', setBy: 'owner',
    });
    await setPolicy({
      founderId: OWNER, kind: 'operating_reserve', amountCents: 0,
      source: 'nothing needs to stay yet', because: 'no running costs', setBy: 'owner',
    });
    const s = await distributableSurplus(OWNER);
    expect(s.figure.quality).toBe('estimated');
  });

  it('supersedes rather than overwrites, so an old reserve stays explicable', async () => {
    await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 2000, basis: 'contribution',
      source: 'first guess', because: 'x', setBy: 'owner',
    });
    await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 3000, basis: 'contribution',
      source: 'second guess', because: 'y', setBy: 'owner',
    });
    const live = await policyInForce(OWNER, 'tax_reserve');
    expect(live?.rateBps).toBe(3000);
    // Ordered by the rate rather than by `set_at`: both were written inside the
    // same second, and a timestamp that cannot separate them is not an order.
    const all = await query(
      `SELECT rate_bps, superseded_at FROM economic_policies
        WHERE founder_id = ? ORDER BY rate_bps`, [OWNER]);
    expect(all.rows).toHaveLength(2);
    const old = all.rows[0] as Record<string, unknown>;
    const now = all.rows[1] as Record<string, unknown>;
    expect(Number(old.rate_bps)).toBe(2000);
    expect(old.superseded_at).not.toBeNull();
    expect(now.superseded_at).toBeNull();
  });
});

describe('the promise with no time limit', () => {
  it('never lets a delivered sale stop being refundable', async () => {
    const f = await fulfilment(2900, 'delivered');
    // `created_at` is immutable by trigger, so the sale is aged by the column
    // that can move. Which is enough: nothing in the exposure reads either.
    await query(
      `UPDATE experiment_fulfilments SET updated_at = datetime('now','-800 days') WHERE id = ?`, [f]);
    const exposure = await refundExposure(OWNER);
    expect(exposure.cents).toBe(2900);
    expect(exposure.because).toMatch(/no time limit/i);
  });

  it('counts what is paid for and undelivered as owed rather than as surplus', async () => {
    await fulfilment(2900, 'owed');
    const owed = await obligationsOutstanding(OWNER);
    expect(owed.cents).toBe(2900);
    const exposure = await refundExposure(OWNER);
    expect(exposure.cents).toBe(0);
  });
});

describe('a shared Stripe account is not a bank account', () => {
  it('refuses to say what has reached a bank', async () => {
    const banked = await moneyBanked();
    expect(banked.cents).toBeNull();
    expect(banked.because).toMatch(/shared/i);
  });

  it('reads no money fact out of a payout event', () => {
    const facts = moneyFactsFromStripeEvent({
      id: 'evt_1', type: 'payout.paid', created: 1,
      data: { object: { id: 'po_1', object: 'payout', amount: 500000, currency: 'usd', metadata: { app: 'foundry' } } },
    });
    expect(facts).toEqual([]);
  });

  it('reads no money fact out of another tenant\'s charge', () => {
    const facts = moneyFactsFromStripeEvent({
      id: 'evt_2', type: 'charge.succeeded', created: 1,
      data: { object: { id: 'ch_land', object: 'charge', amount: 250000, currency: 'usd',
        metadata: { app: 'land', experiment_id: 'x' } } },
    });
    expect(facts).toEqual([]);
  });

  it('reads the charge and its balance transaction out of ours', () => {
    const facts = moneyFactsFromStripeEvent({
      id: 'evt_3', type: 'charge.succeeded', created: 1,
      data: { object: { id: 'ch_ours', object: 'charge', amount: 2900, currency: 'usd',
        payment_intent: 'pi_ours', balance_transaction: 'txn_ours',
        metadata: { app: 'foundry', experiment_id: 'exp_1' } } },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe('charge');
    expect(facts[0].amountCents).toBe(2900);
    expect(facts[0].balanceTransactionRef).toBe('txn_ours');
  });
});

describe('what the owner may actually take', () => {
  it('says there is nothing when nothing has been paid, rather than shrugging', async () => {
    // A fraction of nothing is nothing whatever the rate, and an unset floor
    // keeps back nothing. So an institution that has earned nothing knows
    // exactly what is his: none of it. "Not known" here would be a shrug
    // dressed as rigour.
    const s = await distributableSurplus(OWNER);
    expect(s.held.cents).toBe(0);
    expect(s.taxReserve.cents).toBe(0);
    expect(s.taxReserve.quality).toBe('measured');
    expect(s.figure.cents).toBe(0);
    expect(s.sentence).toMatch(/nobody has paid/i);
  });

  it('will not produce a number while any part of the subtraction is unknown', async () => {
    const f = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'charge', amountCents: 2900, occurredAt: new Date(),
      provider: 'stripe', providerRef: `ch_${f}`, fulfilmentId: f,
      sourceEventId: String(((await query('SELECT payment_event_id FROM experiment_fulfilments WHERE id = ?', [f])).rows[0] as Record<string, unknown>).payment_event_id),
      evidenceMode: 'real', because: 'a buyer paid',
    });
    // Money has come in and its fee was never read, so contribution is unknown,
    // so the basis a tax assumption would apply to is unknown.
    const s = await distributableSurplus(OWNER);
    expect(s.figure.cents).toBeNull();
    expect(s.sentence).toMatch(/will not estimate/i);
  });

  it('goes negative rather than pretending, when everything is spoken for', async () => {
    const f = await fulfilment(2900, 'delivered');
    const eventId = String(((await query('SELECT payment_event_id FROM experiment_fulfilments WHERE id = ?', [f])).rows[0] as Record<string, unknown>).payment_event_id);
    await record({
      founderId: OWNER, kind: 'charge', amountCents: 2900, occurredAt: new Date(),
      provider: 'stripe', providerRef: `ch_${f}`, fulfilmentId: f, sourceEventId: eventId,
      evidenceMode: 'real', because: 'a buyer paid',
    });
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: new Date(),
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 3000, basis: 'contribution',
      source: 'a third of margin', because: 'held back', setBy: 'owner',
    });
    await setPolicy({
      founderId: OWNER, kind: 'operating_reserve', amountCents: 50000,
      source: 'six months of the server', because: 'so it does not go dark', setBy: 'owner',
    });
    const s = await distributableSurplus(OWNER);
    // Held 2,786; refund exposure 2,900 because it is delivered; a $500 floor.
    expect(s.figure.cents).toBeLessThan(0);
    expect(s.sentence).toMatch(/nothing is yours to take/i);
  });

  it('subtracts an allowance the owner has left standing', async () => {
    // Its own company: an allowance is immutable by trigger — withdrawn, never
    // deleted — so a shared one would leak into every later case here.
    const product = nanoid();
    await query('INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,\'active\')',
      [product, 'Allowance company', OWNER]);
    const before = (await distributableSurplus(OWNER)).authorisedCapital.cents ?? 0;
    await query(
      `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents, until)
       VALUES (?,?,?,?,?,datetime('now','+30 days'))`,
      [nanoid(), product, 'testing this idea', 'up to $100', 10000]);
    const after = await distributableSurplus(OWNER);
    expect((after.authorisedCapital.cents ?? 0) - before).toBe(10000);
  });

  it('counts money the owner actually moved, because he saw it happen', async () => {
    await record({
      founderId: OWNER, kind: 'owner_contribution', amountCents: 20000, occurredAt: new Date(),
      provider: 'owner', providerRef: 'contribution_1',
      evidenceMode: 'real', because: 'put in to cover the first month',
    });
    const held = await moneyHeld(OWNER);
    expect(held.cents).toBe(20000);
  });
});

describe('gross is still shown, where it cannot be mistaken for the answer', () => {
  it('reports it separately and says nobody has paid when nobody has', async () => {
    const g = await grossCharged(OWNER);
    expect(g.cents).toBe(0);
    expect(g.quality).toBe('measured');
    expect(g.because).toMatch(/nobody has paid/i);
  });
});

describe('the ledger can be walked back to what somebody said', () => {
  it('lists rows in the order the world put them in, with what stands behind each', async () => {
    const f = await fulfilment(2900, 'delivered');
    const eventId = String(((await query('SELECT payment_event_id FROM experiment_fulfilments WHERE id = ?', [f])).rows[0] as Record<string, unknown>).payment_event_id);
    await record({
      founderId: OWNER, kind: 'charge', amountCents: 2900, occurredAt: '2026-01-02 10:00:00',
      provider: 'stripe', providerRef: `ch_${f}`, fulfilmentId: f, sourceEventId: eventId,
      evidenceMode: 'real', because: 'a buyer paid',
    });
    await record({
      founderId: OWNER, kind: 'provider_fee', amountCents: 114, occurredAt: '2026-01-03 10:00:00',
      provider: 'stripe', providerRef: `txn_${f}`, fulfilmentId: f,
      evidenceMode: 'real', because: 'what Stripe took',
    });
    const rows = await ledgerEntries(OWNER);
    expect(rows).toHaveLength(2);
    // Newest first, by the SOURCE's clock rather than by ours.
    expect(rows[0].kind).toBe('provider_fee');
    expect(rows[1].kind).toBe('charge');
    expect(rows[1].fromEvent).toBeTruthy();
    expect(rows[0].quality).toBe('measured');
    expect(rows[0].direction).toBe('out');
  });

  it('names the assumption on a row that rests on one', async () => {
    const f = await fulfilment(2900, 'delivered');
    const policyId = await setPolicy({
      founderId: OWNER, kind: 'tax_reserve', rateBps: 3000, basis: 'contribution',
      source: 'a third of margin, on my accountant\'s advice', because: 'held back', setBy: 'owner',
    });
    await record({
      founderId: OWNER, kind: 'unit_cost', amountCents: 100, occurredAt: new Date(),
      provider: 'internal', providerRef: `est_${f}`, fulfilmentId: f,
      claimQuality: 'estimated', policyId, evidenceMode: 'real', because: 'an estimated cost',
    });
    const rows = await ledgerEntries(OWNER);
    expect(rows[0].quality).toBe('estimated');
    expect(rows[0].assumption).toMatch(/a third of margin/);
  });

  it('shows nothing from a rehearsal in a real reading', async () => {
    const f = await fulfilment(2900, 'delivered');
    await record({
      founderId: OWNER, kind: 'unit_cost', amountCents: 999, occurredAt: new Date(),
      provider: 'internal', providerRef: `sandbox_${f}`, fulfilmentId: f,
      evidenceMode: 'sandbox', because: 'a rehearsal',
    });
    const rows = await ledgerEntries(OWNER);
    expect(rows).toHaveLength(0);
    const u = await unitContribution(OWNER, f);
    expect(u.unitCosts.cents).toBe(0);
  });
});

describe('what running this has cost', () => {
  it('totals only what a provider has actually billed for', async () => {
    await query(
      `INSERT INTO asset_money_spent (id, product_id, tool, amount_cents, source, provider_ref)
       VALUES (?,?,?,?,?,?)`, [nanoid(), PRODUCT, 'anthropic', 400, 'settled', 'req_abc']);
    await query(
      `INSERT INTO asset_money_spent (id, product_id, tool, amount_cents, source)
       VALUES (?,?,?,?,?)`, [nanoid(), PRODUCT, 'anthropic', 900, 'reserved']);
    const cost = await runningCost(OWNER);
    // The reservation is money committed before the wire, not money billed.
    expect(cost.total.cents).toBe(400);
    expect(cost.recent).toHaveLength(2);
    expect(cost.recent.find((r) => r.source === 'settled')?.providerRef).toBe('req_abc');
  });

  it('is kept out of the subtraction, so putting money in cannot count twice', async () => {
    await query(
      `INSERT INTO asset_money_spent (id, product_id, tool, amount_cents, source, provider_ref)
       VALUES (?,?,?,?,?,?)`, [nanoid(), PRODUCT, 'anthropic', 400, 'settled', 'req_xyz']);
    const s = await distributableSurplus(OWNER);
    expect(s.held.cents).toBe(0);
    expect(s.figure.cents).toBe(0);
  });
});

// GATE 1, CASE 11: A LEDGER SUM IS NOT A WITHDRAWAL. "$X is yours to take" was
// said of what the recorded events add up to, while the only bank-real figure
// here is permanently unavailable. Charge, fee, payout, deposit and reserve are
// different facts; this sentence may only claim the one it has.
describe('what the ledger adds up to is not money in a bank', () => {
  it('never says "yours to take" of an unreconciled sum', async () => {
    const { surplusSentence } = await import('../../src/services/economy/projection.js');
    const s = surplusSentence({ cents: 2_000, quality: 'measured', because: 'x' }, { cents: 2_900, quality: 'measured', because: 'x' });
    expect(s).not.toMatch(/yours to take/);
    expect(s).toMatch(/not money seen in a bank/);
    expect(s).toMatch(/\$20\.00/);
  });
});
