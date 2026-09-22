// =============================================================================
// AN OBLIGATION KNOWS WHICH CHANNEL IT CAME FROM.
//
// The owner: distinguish an obligation Foundry independently observed from one
// a marketplace reported, from one inferred, from one it cannot currently
// observe, and from one requiring his manual action. "Do not infer that Etsy
// handles every possible customer responsibility or that Apex Micro has none."
// And: "Do not describe manual obligations as autonomously fulfilled."
//
// TWO THINGS WERE WRONG, AND THE FIRST ONE MEANT A BUYER COULD NOT BE OWED.
//
// `recordVenueOrder` marks a venue fulfilment `delivered` on insert — correctly,
// because the venue hands the file over the moment payment confirms — and
// `recordVenueRefund` wrote the request and the refund reference in one
// statement, for a refund already made. Between them there was no state for
// "asked for, not yet given", so `OPEN_OBLIGATION` could never be true for a
// marketplace sale. The refunds page promises a refund with no form and no time
// limit; nothing in the institution could see one being owed.
//
// The second: every remedy sentence ended "in Stripe". That is true of a charge
// Foundry took and false of a marketplace order, and it sends the owner to an
// account where the charge does not exist.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  approveListing, recordListing, recordVenueOrder, recordVenueRefund, requestVenueRefund, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { obligationsFor } from '../../src/services/venture/obligations.js';

const OWNER = 'ob_owner';
const LISTING = 'https://www.etsy.com/listing/9988776655/bid-decision-workbook';
const ORDER = '3001234567';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ob', 'thomas@example.com', 'Owner']);
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: LISTING });
  await recordVenueOrder({
    founderId: OWNER, experimentId: X,
    order: { orderRef: ORDER, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 },
  });
});

describe('how it came to be known is recorded, because silence means different things', () => {
  it('marks a venue order as the owner having typed it off a statement', async () => {
    const r = (await query(
      'SELECT provider, observed_how, status FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER]))
      .rows[0] as Record<string, unknown>;
    expect(String(r.provider)).toBe('etsy');
    // NOT `foundry_observed`. Nothing here watches Etsy; this row is as
    // complete as his attention was, and saying otherwise would turn his
    // typing into an institutional observation.
    expect(String(r.observed_how)).toBe('owner_entered');
    expect(String(r.status)).toBe('delivered');
  });

  it('refuses to let a channel default into looking observed', async () => {
    await expect(query(
      // check-vocabulary:expected-refusal
      `UPDATE experiment_fulfilments SET observed_how = 'telepathy' WHERE payment_ref = ?`, [ORDER]))
      .rejects.toThrow();
  });
});

describe('a buyer on the venue can now be owed something', () => {
  it('opens an obligation that could not previously exist', async () => {
    // Before this, `OPEN_OBLIGATION` could never be true for a marketplace
    // sale: delivered on insert, and the only refund writer set the reference
    // in the same statement as the request.
    expect(await obligationsFor(OWNER)).toHaveLength(0);

    const asked = await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: ORDER });
    expect(asked.alreadyOpen).toBe(false);

    const owed = await obligationsFor(OWNER);
    expect(owed).toHaveLength(1);
    expect(owed[0].paymentRef).toBe(ORDER);
    expect(owed[0].amountCents).toBe(1400);
    expect(owed[0].state).toBe('refund_requested');
  });

  it('asked twice is still one buyer waiting, dated from the first time', async () => {
    const again = await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: ORDER });
    expect(again.alreadyOpen).toBe(true);
    expect(await obligationsFor(OWNER)).toHaveLength(1);
  });

  it('refuses a refund request against an order nobody recorded', async () => {
    await expect(requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: 'not-an-order' }))
      .rejects.toThrow(/no_such_order/);
  });
});

describe('the remedy points at the account the money is actually in', () => {
  it('names the venue and the order, and never sends him to Stripe', async () => {
    const owed = (await obligationsFor(OWNER))[0];
    expect(owed.provider).toBe('etsy');
    expect(owed.action).toBe('refund_on_the_venue');
    expect(owed.asksHim).toContain('Etsy');
    expect(owed.asksHim).toContain(ORDER);
    // THE SENTENCE THAT WOULD HAVE SENT HIM TO AN ACCOUNT WHERE THE CHARGE
    // DOES NOT EXIST.
    expect(owed.asksHim).not.toContain('in Stripe');
    expect(owed.sentence).not.toContain('Stripe');
  });

  it('says plainly that Foundry has no way to do it, rather than promising to try', async () => {
    const owed = (await obligationsFor(OWNER))[0];
    // Not "I try again on the next pass" — there is no pass that could. A
    // promise nothing can keep is worse than an honest hand-off.
    expect(owed.sentence).not.toContain('next pass');
    expect(owed.asksHim).toContain('no way to move');
  });

  it('carries how it was seen, so the owner can weigh the record', async () => {
    const owed = (await obligationsFor(OWNER))[0];
    expect(owed.observedHow).toBe('owner_entered');
  });
});

describe('recording the refund he made closes it', () => {
  it('closes the obligation and leaves the history true', async () => {
    await recordVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER,
      refundedAt: new Date().toISOString(), amountCents: 1400,
    });
    expect(await obligationsFor(OWNER)).toHaveLength(0);
    const r = (await query(
      'SELECT status, refund_ref, refund_requested_at FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER]))
      .rows[0] as Record<string, unknown>;
    expect(String(r.status)).toBe('refunded');
    expect(r.refund_ref).not.toBeNull();
    // The request it discharges is still dated, so how long the buyer waited
    // survives the refund.
    expect(r.refund_requested_at).not.toBeNull();
  });
});

// =============================================================================
// WHAT THE FIRST PASS AT THIS GOT WRONG.
//
// An independent adversarial cell read the commit above and found that the
// vocabulary had landed and the mechanism had not: `requestVenueRefund` had no
// caller anywhere in the running system, so the one state the public refunds
// page promises to honour — somebody asked, and has not been paid — could not
// be entered by any means. Everything below it was reachable only from the
// test directly above.
//
// It found five more, and every one of them is about the institution's account
// of money being false rather than about money moving wrongly. They are worse
// for that: money that moves wrongly is noticed.
// =============================================================================

describe('the mechanism has a way in', () => {
  it('is reachable from the owner\'s own page, not only from a test', async () => {
    const { readFileSync } = await import('node:fs');
    const routes = readFileSync('src/routes/dashboard/experiments-place.ts', 'utf8');
    // The gate that should have caught this cannot: `check-reachability.mjs`
    // walks module imports, and an unreachable EXPORT inside a reachable
    // module is invisible to it.
    expect(routes).toContain('requestVenueRefund');
    expect(routes).toContain("/foundry/experiments/:id/refund-asked");
    // And the form that posts to it, because a route nothing links to is the
    // same defect one layer up.
    expect(routes).toContain('/refund-asked" class="stack"');
  });

  it('keeps asking and paying as two events with two dates', async () => {
    const { readFileSync } = await import('node:fs');
    const routes = readFileSync('src/routes/dashboard/experiments-place.ts', 'utf8');
    // Collapsing them is what erased how long a buyer waited.
    expect(routes).toContain("/foundry/experiments/:id/refund'");
    expect(routes).toContain("/foundry/experiments/:id/refund-asked'");
  });
});

describe('a part refund does not close what is still owed', () => {
  const ORDER2 = '3009999001';

  beforeAll(async () => {
    await recordVenueOrder({
      founderId: OWNER, experimentId: X,
      order: { orderRef: ORDER2, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 },
    });
    await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: ORDER2 });
  });

  it('refuses to refund more than is left', async () => {
    // Nothing capped the amount at gross, so a keying error of 29000 for 2900
    // wrote a refund ten times the charge and `moneyHeld` subtracted it.
    await expect(recordVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER2,
      refundedAt: new Date().toISOString(), amountCents: 140000,
    })).rejects.toThrow(/more than is left/);
  });

  it('leaves the buyer owed the remainder after a part refund', async () => {
    await recordVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER2,
      refundedAt: new Date().toISOString(), amountCents: 200,
    });
    const r = (await query(
      'SELECT status, refund_ref FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER2]))
      .rows[0] as Record<string, unknown>;
    // `status = 'refunded'` plus a `refund_ref` turns OPEN_OBLIGATION false on
    // every clause, and `refund_is_final` then makes it irreversible. A $2
    // refund on a $14 order used to do exactly that.
    expect(String(r.status)).not.toBe('refunded');
    expect(r.refund_ref).toBeNull();
    const owed = (await obligationsFor(OWNER)).filter((o) => o.paymentRef === ORDER2);
    expect(owed, 'the buyer is still owed the rest').toHaveLength(1);
  });

  it('records the second instalment instead of silently swallowing it', async () => {
    // The ledger dedupes on (provider, ref, kind) and the ref was a fixed
    // `<order>:refund`, so a second part refund returned `duplicate` and wrote
    // no ledger row and no fulfilment update at all — while reporting success.
    await recordVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER2,
      refundedAt: new Date().toISOString(), amountCents: 1200,
    });
    const n = (await query(
      `SELECT coalesce(SUM(amount_cents),0) AS total, COUNT(*) AS c FROM economic_events
        WHERE provider_ref LIKE ? AND kind = 'refund'`, [`${ORDER2}:refund%`]))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.c)).toBe(2);
    expect(Number(n.total)).toBe(1400);
  });

  it('closes only when the whole of it has gone back', async () => {
    const r = (await query(
      'SELECT status, refund_ref FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER2]))
      .rows[0] as Record<string, unknown>;
    expect(String(r.status)).toBe('refunded');
    expect(r.refund_ref).not.toBeNull();
    expect((await obligationsFor(OWNER)).filter((o) => o.paymentRef === ORDER2)).toHaveLength(0);
  });
});

describe('the refund is attached to the sale it reverses', () => {
  it('carries the fulfilment id, so the unit does not report full contribution', async () => {
    // `unitContribution` reads the refund per-unit with
    // `WHERE fulfilment_id = ?`. With NULL it read zero and reported gross
    // minus fee on a sale that was given back. The charge and the fee beside it
    // were always linked; only the refund was not, and nothing enforced it
    // because a refund is `is_unit_cost = 0`.
    const rows = (await query(
      `SELECT fulfilment_id FROM economic_events WHERE kind = 'refund'`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.fulfilment_id).not.toBeNull();
  });

  it('refunds in the currency the buyer was charged', async () => {
    // Both writes hard-coded 'usd' while the order honoured its own currency,
    // and `moneyHeld` sums across currencies with no grouping — so EUR14
    // charged and "$14" refunded netted to zero held.
    const rows = (await query(
      `SELECT e.currency AS refund_currency, f.currency AS charge_currency
         FROM economic_events e JOIN experiment_fulfilments f ON f.id = e.fulfilment_id
        WHERE e.kind = 'refund'`)).rows as unknown as Array<Record<string, unknown>>;
    for (const r of rows) expect(String(r.refund_currency)).toBe(String(r.charge_currency));
  });

  it('does not read its currency from a literal', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/services/venture/proof-2.ts', 'utf8');
    expect(src).not.toContain("currency: 'usd'");
  });
});

describe('how long the buyer waited survives the refund', () => {
  it('keeps the date they asked rather than the date they were paid', async () => {
    const ORDER3 = '3009999002';
    await recordVenueOrder({
      founderId: OWNER, experimentId: X,
      order: { orderRef: ORDER3, paidAt: '2026-09-01T10:00:00.000Z', grossCents: 1400, feeCents: 158 },
    });
    await requestVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER3, askedAt: '2026-09-02T10:00:00.000Z',
    });
    await recordVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER3,
      refundedAt: '2026-09-20T10:00:00.000Z', amountCents: 1400,
    });
    const r = (await query(
      'SELECT refund_requested_at FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER3]))
      .rows[0] as Record<string, unknown>;
    // It assigned the refund's own date unconditionally, so the eighteen days
    // this buyer waited became zero at the moment they were paid.
    expect(String(r.refund_requested_at)).toContain('2026-09-02');
  });
});

describe('an obligation nobody classified is never called settled', () => {
  it('does not tell the owner nobody is owed anything while somebody is', async () => {
    const ORDER4 = '3009999003';
    await recordVenueOrder({
      founderId: OWNER, experimentId: X,
      order: { orderRef: ORDER4, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 },
    });
    await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: ORDER4 });

    const { howThisWouldEnd } = await import('../../src/services/institution/winding-down.js');
    const end = await howThisWouldEnd(OWNER);
    // `refund_on_the_venue` was added to the obligations vocabulary and not to
    // the wind-down switch, which had no default — so it landed in neither
    // list, and with it as the only open obligation the page read "Nobody is
    // owed anything. Stopping now would leave nothing outstanding."
    const all = [...end.itWillFinish, ...end.itCannotSettle];
    expect(all.length, 'a waiting buyer must appear somewhere').toBeGreaterThan(0);
    expect(end.itCannotSettle.some((x) => /venue|marketplace/i.test(x.because))).toBe(true);
  });
});

describe('the pass that cannot refund a venue no longer tries', () => {
  it('filters on the provider in the SQL, not in the loop', async () => {
    const { readFileSync } = await import('node:fs');
    const hand = readFileSync('src/services/venture/hand.ts', 'utf8');
    // With no provider clause, every hourly pass reached `refundFulfilment`,
    // came back `charge_unknown` (a venue row carries no `charge_ref`) and
    // pushed an exception that made the experiment read as blocked — for as
    // long as the buyer waited. No money could move; what was damaged was what
    // the owner was told.
    expect(hand).toContain("AND f.provider = 'stripe'");
  });
});

describe('a channel nobody watches cannot claim to have been watched', () => {
  it('refuses a venue row that says Foundry observed it', async () => {
    await expect(query(
      // check-vocabulary:expected-refusal
      `INSERT INTO experiment_fulfilments
         (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, amount_cents, currency, observed_how)
       SELECT 'ob_fake', founder_id, experiment_id, exposure_id, payment_event_id, 'etsy', 'fake-1', 100, 'usd', 'foundry_observed'
         FROM experiment_fulfilments LIMIT 1`))
      .rejects.toThrow(/not_a_channel_foundry_watches/);
  });

  it('refuses to promote a typed row to an observed one afterwards', async () => {
    // The CHECK closes the vocabulary and `foundry_observed` is IN the
    // vocabulary, so nothing stopped an UPDATE quietly upgrading the claim.
    // `provider` beside it is immutable; this had to be too.
    await expect(query(
      // check-vocabulary:expected-refusal
      `UPDATE experiment_fulfilments SET observed_how = 'foundry_observed' WHERE payment_ref = ?`, [ORDER]))
      .rejects.toThrow(/observation_is_immutable/);
  });
});
