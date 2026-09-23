// =============================================================================
// THE FIRST PROOF MUST NOT BE CORRUPTED BY THE MACHINERY THAT MEASURES IT.
//
// An independent review (22 September 2026) read this repository at d6033cbc
// and named four ways the first real external sale could be recorded wrongly.
// It ran nothing: every finding was inspection plus inference, and the brief
// that came with it said so and asked for them to be verified rather than
// believed. Three of the four reproduced. This file is the verification and
// the guard.
//
//   F1  A failure between the payment event and everything downstream left an
//       order half-recorded, and every replay returned early because the
//       payment was already known. CONFIRMED by inspection: the early return
//       on `paid.duplicate` sat above the delivery event, the fulfilment, the
//       charge and the fee.
//
//   F2  A receipt was kept if ANY line named this test's listing, and then the
//       whole basket's `grandtotal` was booked as this asset's result.
//       CONFIRMED.
//
//   F3  Zero orders were filed as evidence CONTRADICTING the claim that buyers
//       would pay — in the same row whose own sentence said no listing of the
//       test was live. CONFIRMED, and the worst of the three, because
//       `from_absence` made it the institution's strongest form of negative
//       evidence, written immutably, once a day, about a shop with nothing in
//       it for sale.
//
//   F5  Money language named Stripe while the first real asset sells on Etsy,
//       and unlike currencies were added together. CONFIRMED. The rest of F5 —
//       a sale, a payout and a deposit counting three times, and a missing fee
//       becoming margin — did NOT reproduce: `economic_event_kinds.affects_cash`
//       already excludes payouts from held money, and `unitContribution`
//       already refuses to report a contribution when the fee is unread. Those
//       are asserted here too, because a finding that was already handled is
//       worth a test that keeps it handled.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'd'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const LISTING_ID = '9988776655';
const OTHER_ID = '1122334455';

/** Etsy's part, played by a double. Every shape is from its published v3 API. */
const ETSY: Record<string, unknown> = {
  'users/me': { user_id: 42, shop_id: 77770001 },
  'shops/77770001': { shop_id: 77770001, shop_name: 'ApexMicro', url: 'https://www.etsy.com/shop/ApexMicro' },
  'shops/77770001/listings': { count: 0, results: [] },
  'shops/77770001/receipts': { count: 0, results: [] },
};

vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async (url: string) => {
    const path = url.replace('https://openapi.etsy.com/v3/application/', '').split('?')[0];
    const body = ETSY[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }),
  assertUrlSafe: vi.fn(async (u: string) => new URL(u)),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encrypt, encryptCredentialPayload } from '../../src/services/encryption.js';
import { approveListing, recordListing, recordVenueOrder, seedProof2 } from '../../src/services/venture/proof-2.js';
import { readTheShop, bringTheVenueUpToDate } from '../../src/services/senses/readers/etsy-shop.js';
import { recordBusinessOutcome } from '../../src/services/venture/outcome.js';
import { moneyHeld, distributableSurplus, unitContribution } from '../../src/services/economy/projection.js';

const OWNER = 'fp_owner';
let PRODUCT = '';
let X = '';

/** A receipt as Etsy states one, with the lines it actually carries. */
const receipt = (
  id: string, total: number, lines: Array<[string, number, number]>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  receipt_id: id,
  is_paid: true,
  created_timestamp: 1760000000,
  grandtotal: { amount: total, divisor: 100, currency_code: 'USD' },
  transactions: lines.map(([listingId, price, quantity]) => ({
    listing_id: listingId, quantity,
    price: { amount: price, divisor: 100, currency_code: 'USD' },
  })),
  ...extra,
});

async function connect(): Promise<void> {
  const senseId = nanoid();
  await query(
    `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
     VALUES (?,?,'revenue','etsy','real','read-only, for this test')`, [senseId, PRODUCT]);
  await query(
    `INSERT INTO sense_credentials
       (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
     VALUES (?,?,?,'etsy',?,?,?)`,
    [nanoid(), senseId, PRODUCT, JSON.stringify(['shops_r', 'listings_r', 'transactions_r']),
      encryptCredentialPayload(JSON.stringify({ access_token: 'tok', shop_id: '77770001' })),
      new Date(Date.now() + 3600_000).toISOString()]);
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_fp', 'thomas@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query(
    'SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4242', datetime('now'), 'test')`,
    [encrypt(JSON.stringify({ keystring: 'test-keystring', sharedSecret: 'test-secret' }))]);
  await connect();
});

beforeEach(() => { ETSY['shops/77770001/receipts'] = { count: 0, results: [] }; });

// ─── F3 ──────────────────────────────────────────────────────────────────────

describe('an empty shop with nothing for sale is not a market saying no', () => {
  it('files no evidence against the claim before a listing of the test is live', async () => {
    // THE FINDING, AND IT WAS THE WORST OF THEM. `bearing` was
    // `orders.length > 0 ? 'supports' : 'contradicts'`, and the sentence it
    // filed alongside said, in as many words, "no listing of this test is
    // live, so no order is attributed to it". An empty shop with nothing in
    // it for sale was being recorded, immutably and once a day, as the market
    // declining to buy.
    const before = (await query('SELECT COUNT(*) AS n FROM market_observations')).rows[0] as Record<string, unknown>;
    const r = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect('read' in r && r.read).toBe(true);
    const after = (await query('SELECT COUNT(*) AS n FROM market_observations')).rows[0] as Record<string, unknown>;
    expect(Number(after.n), 'an observation was filed with nothing listed').toBe(Number(before.n));
  });

  it('still reads the shop and still proves the capability, which is the point', async () => {
    // Not filing the observation must not mean not looking. The read happens,
    // the ladder is witnessed on it, and the retrieval keeps its own record.
    const m = (await query(
      `SELECT p.maturity FROM capability_providers p JOIN capabilities c ON c.capability_key = p.capability_key
        WHERE p.provider = 'etsy' AND c.rung = 'observe' LIMIT 1`)).rows[0] as Record<string, unknown>;
    expect(['reality_proven', 'reliable']).toContain(String(m.maturity));
  });

  it('files the contradiction once the test is actually exposed and nothing sells', async () => {
    // A live listing and a complete reading of zero orders IS the market
    // answering, and it is filed as one.
    await recordListing({ founderId: OWNER, experimentId: X,
      url: `https://www.etsy.com/listing/${LISTING_ID}/bid-decision-workbook` });
    const before = (await query(
      "SELECT COUNT(*) AS n FROM market_observations WHERE bearing = 'contradicts'")).rows[0] as Record<string, unknown>;
    await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    const after = (await query(
      "SELECT COUNT(*) AS n FROM market_observations WHERE bearing = 'contradicts'")).rows[0] as Record<string, unknown>;
    expect(Number(after.n)).toBe(Number(before.n) + 1);
  });
});

// ─── F2 ──────────────────────────────────────────────────────────────────────

describe('a receipt this listing appears on is not a receipt that is all ours', () => {
  it('passes over an order with nothing of ours in it', async () => {
    ETSY['shops/77770001/receipts'] = { count: 1, results: [receipt('R1', 2000, [[OTHER_ID, 2000, 1]])] };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    expect('failed' in r).toBe(false);
    if ('failed' in r) return;
    expect(r.orders).toHaveLength(0);
    // Not a discard either: somebody else's sale is not a shape we failed to
    // read, and counting it as one would poison the completeness reading.
    expect(r.complete).toBe(true);
  });

  it('books the whole receipt when the whole receipt is ours', async () => {
    ETSY['shops/77770001/receipts'] = { count: 1, results: [receipt('R2', 1400, [[LISTING_ID, 1400, 1]])] };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].grossCents).toBe(1400);
    expect(r.orders[0].whollyThisListing).toBe(true);
  });

  it('books only our lines when the basket carried something else', async () => {
    // THE FINDING. A $34 basket holding our $14 workbook and a $20 something
    // else was booked as a $34 sale of the workbook, with the receipt's fee
    // against it. Line attribution comes from Etsy's own stated line price.
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [receipt('R3', 3400, [[LISTING_ID, 1400, 1], [OTHER_ID, 2000, 1]])],
    };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].grossCents, 'the basket was booked as ours').toBe(1400);
    expect(r.orders[0].whollyThisListing).toBe(false);
    // AND THE SHARED COMPONENTS STAY UNKNOWN. The receipt's fee covers items
    // that are not ours; apportioning it needs a rule nobody has decided, and
    // inventing one would put a number in the ledger no statement supports.
    expect(r.orders[0].feeCents).toBeNull();
  });

  it('never books the sales tax Etsy remits to a state as this asset\'s revenue', async () => {
    // THE DEEPER HALF, and it was true even for a receipt entirely ours.
    // `grandtotal` is what the BUYER PAID: items, shipping, gift wrap, and the
    // sales tax Etsy collects as marketplace facilitator. The tax is never the
    // seller's money — and booking it would have inflated the first real sale
    // by whatever the buyer's state levies AND reserved cash against it, since
    // refund exposure is taken at full price.
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [receipt('TAX1', 1638, [[LISTING_ID, 1400, 1]], {
        total_tax_cost: { amount: 118, divisor: 100, currency_code: 'USD' },
        total_shipping_cost: { amount: 120, divisor: 100, currency_code: 'USD' },
      })],
    };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders[0].grossCents, 'the buyer paid 16.38; the asset earned 14.00').toBe(1400);
    expect(r.orders[0].whollyThisListing).toBe(true);
  });

  it('takes a shop discount off, because that one really is the seller\'s', async () => {
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [receipt('DISC1', 1200, [[LISTING_ID, 1400, 1]], {
        discount_amt: { amount: 200, divisor: 100, currency_code: 'USD' },
      })],
    };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders[0].grossCents).toBe(1200);
  });

  it('will not attribute a mixed basket that also carried a discount', async () => {
    // Shared between items, and apportioning it needs a rule nobody has
    // decided. Unattributable rather than attributed generously — and counted
    // as a gap so the incompleteness is visible.
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [receipt('DISC2', 3200, [[LISTING_ID, 1400, 1], [OTHER_ID, 2000, 1]], {
        discount_amt: { amount: 200, divisor: 100, currency_code: 'USD' },
      })],
    };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders).toHaveLength(0);
    expect(r.complete).toBe(false);
  });

  it('counts quantity, because two of ours is twice ours', async () => {
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [receipt('R4', 4800, [[LISTING_ID, 1400, 2], [OTHER_ID, 2000, 1]])],
    };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders[0].grossCents).toBe(2800);
  });

  it('treats a mixed receipt it cannot read as a gap, never as a clean absence', async () => {
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [{
        ...receipt('R5', 3400, [[OTHER_ID, 2000, 1]]),
        transactions: [{ listing_id: LISTING_ID, quantity: 1, price: null },
          { listing_id: OTHER_ID, quantity: 1, price: { amount: 2000, divisor: 100, currency_code: 'USD' } }],
      }],
    };
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID });
    if ('failed' in r) throw new Error('read failed');
    expect(r.orders).toHaveLength(0);
    // Incomplete, so no silence downstream can be read as an absence while a
    // sale sits in this shop unattributed.
    expect(r.complete).toBe(false);
  });

  it('says in the ledger that a mixed order is this listing only', async () => {
    await recordVenueOrder({ founderId: OWNER, experimentId: X, observedHow: 'venue_reported',
      order: { orderRef: 'MIX1', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: null, whollyThisListing: false } });
    const row = (await query(
      "SELECT because FROM economic_events WHERE provider_ref = 'MIX1' AND kind = 'charge'"))
      .rows[0] as Record<string, unknown>;
    expect(String(row.because)).toContain("this listing's lines only");
    expect(String(row.because)).toContain('not apportioned');
  });

  it('cannot report a contribution for it, because the fee is genuinely unknown', async () => {
    // Already true before the review and asserted here so it stays true: a
    // missing fee becomes an unavailable contribution, never margin.
    const f = (await query(
      "SELECT id FROM experiment_fulfilments WHERE payment_ref = 'MIX1'")).rows[0] as Record<string, unknown>;
    const c = await unitContribution(OWNER, String(f.id));
    expect(c.providerFee.quality).toBe('unavailable');
    expect(c.contribution.cents).toBeNull();
  });
});

// ─── F1 ──────────────────────────────────────────────────────────────────────

describe('an order half-recorded is repaired by the next reading', () => {
  const REF = 'CRASH1';

  it('leaves nothing downstream when it stops after the payment', async () => {
    // THE INJECTION, and it is the real failure rather than a simulated one:
    // this is exactly the state a crash after `recordBusinessOutcome` leaves —
    // the payment event on the record and nothing else.
    const x = (await query(
      'SELECT id FROM experiment_exposures WHERE experiment_id = ? ORDER BY rowid DESC LIMIT 1',
      [X])).rows[0] as Record<string, unknown>;
    const paid = await recordBusinessOutcome({
      exposureId: String(x.id), kind: 'payment', amountCents: 1400, currency: 'usd',
      observedAt: new Date(), provider: 'etsy', providerRef: REF,
      payerReference: `order:${REF}`, arrivedVia: 'etsy', exchange: 'upfront_price' });
    expect('refused' in paid).toBe(false);
    expect((await query(
      "SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?", [REF]))
      .rows[0]).toMatchObject({ n: 0 });
  });

  it('completes on replay rather than returning as though it were done', async () => {
    // Before this, the replay hit the early return on `paid.duplicate` and
    // reported the order complete with `fulfilmentId: ''`. The hourly reader
    // would have re-read the same receipt forever and repaired nothing.
    const r = await recordVenueOrder({ founderId: OWNER, experimentId: X, observedHow: 'venue_reported',
      order: { orderRef: REF, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: null } });
    expect(r.duplicate, 'the payment was already known and should still say so').toBe(true);
    expect(r.fulfilmentId).not.toBe('');
    expect((await query(
      "SELECT status FROM experiment_fulfilments WHERE payment_ref = ?", [REF]))
      .rows[0]).toMatchObject({ status: 'delivered' });
    expect((await query(
      "SELECT COUNT(*) AS n FROM economic_events WHERE provider_ref = ? AND kind = 'charge'", [REF]))
      .rows[0]).toMatchObject({ n: 1 });
    expect((await query(
      "SELECT COUNT(*) AS n FROM business_outcome_events WHERE provider_event_ref = ?",
      [`${REF}:download-available`])).rows[0]).toMatchObject({ n: 1 });
  });

  it('records a fee that was not on the statement the first time it looked', async () => {
    // `feeCents: null` means "not yet published", and the early return made it
    // permanent: the second reading could never add it.
    await recordVenueOrder({ founderId: OWNER, experimentId: X, observedHow: 'venue_reported',
      order: { orderRef: REF, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 178 } });
    expect((await query(
      "SELECT amount_cents FROM economic_events WHERE provider_ref = ? AND kind = 'provider_fee'",
      [`${REF}:fees`])).rows[0]).toMatchObject({ amount_cents: 178 });
  });

  it('replays a complete order without creating a second anything', async () => {
    const count = async (sql: string): Promise<number> =>
      Number((((await query(sql, [REF])).rows[0]) as Record<string, unknown>).n);
    const before = [
      await count("SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?"),
      await count("SELECT COUNT(*) AS n FROM economic_events WHERE provider_ref LIKE ? || '%'"),
      await count("SELECT COUNT(*) AS n FROM business_outcome_events WHERE provider_event_ref LIKE ? || '%'"),
    ];
    await recordVenueOrder({ founderId: OWNER, experimentId: X, observedHow: 'venue_reported',
      order: { orderRef: REF, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 178 } });
    const after = [
      await count("SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = ?"),
      await count("SELECT COUNT(*) AS n FROM economic_events WHERE provider_ref LIKE ? || '%'"),
      await count("SELECT COUNT(*) AS n FROM business_outcome_events WHERE provider_event_ref LIKE ? || '%'"),
    ];
    expect(after).toEqual(before);
  });
});

// ─── F5 ──────────────────────────────────────────────────────────────────────

describe('the money says what it is, and refuses what it cannot say', () => {
  it('does not name Stripe for money that came from a marketplace', async () => {
    // The first real asset sells on Etsy, and its charges are written to this
    // same ledger. "What is ours in Stripe's balance" was summing them.
    const held = await moneyHeld(OWNER);
    expect(held.because).not.toContain('Stripe');
    const s = await distributableSurplus(OWNER);
    expect(s.figure.because).not.toContain('Stripe');
  });

  it('separates the most that could be asked back from what is being held back', async () => {
    const s = await distributableSurplus(OWNER);
    expect(s.refundExposure.cents).toBe(s.refundReserve.cents);
    // Equal, and not the same fact. One is arithmetic; the other is a choice,
    // and reporting only the first made a deliberate policy look inevitable.
    expect(s.refundReserve.because).not.toBe(s.refundExposure.because);
    if ((s.refundExposure.cents ?? 0) > 0) {
      expect(s.refundReserve.because).toContain('policy choice');
      expect(s.refundReserve.because).toContain('no form and no time limit');
    }
  });

  it('refuses to add unlike currencies together', async () => {
    // Etsy sells in the buyer's currency. Every sum here was
    // `SUM(amount_cents)` with no grouping, so the first order from outside
    // the United States would have been added to dollars as though a euro cent
    // were a cent.
    const x = (await query(
      'SELECT id FROM experiment_exposures WHERE experiment_id = ? ORDER BY rowid DESC LIMIT 1',
      [X])).rows[0] as Record<string, unknown>;
    await recordBusinessOutcome({ exposureId: String(x.id), kind: 'payment', amountCents: 1200,
      currency: 'eur', observedAt: new Date(), provider: 'etsy', providerRef: 'EUR1',
      payerReference: 'order:EUR1', arrivedVia: 'etsy', exchange: 'upfront_price' });
    await recordVenueOrder({ founderId: OWNER, experimentId: X, observedHow: 'venue_reported',
      order: { orderRef: 'EUR1', paidAt: new Date().toISOString(), grossCents: 1200, feeCents: 150, currency: 'eur' } });
    const held = await moneyHeld(OWNER);
    expect(held.quality).toBe('unavailable');
    expect(held.because).toContain('more than one currency');
    // And the surplus refuses with it, rather than quoting a number built on it.
    const s = await distributableSurplus(OWNER);
    expect(s.figure.quality).toBe('unavailable');
  });

  it('never counts a payout as a second sale, which it already did not', async () => {
    // Reported as a risk; it does not reproduce. `economic_event_kinds` marks
    // a payout `affects_cash = 1` and `moneyHeld` reads only the events that
    // are not cash movements, so a payout of money already counted as a charge
    // cannot count again. Asserted so it stays that way.
    const k = (await query(
      "SELECT affects_cash FROM economic_event_kinds WHERE kind = 'payout'"))
      .rows[0] as Record<string, unknown>;
    expect(Number(k.affects_cash)).toBe(1);
  });
});
