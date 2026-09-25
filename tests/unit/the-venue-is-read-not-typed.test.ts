// =============================================================================
// THE VENUE IS READ, NOT TYPED.
//
// The owner asked for the first genuinely qualified external operating
// capability, proved by "the smallest legitimate, controlled real-account
// qualification sequence" — and, in the same instruction, that Foundry not
// publish the workbook or incur listing fees to establish that the integration
// works, using "nonconsequential operations and permitted test mechanisms
// wherever possible".
//
// This is that permitted test mechanism. Etsy's part is played by a double, so
// every step of the path runs — the identity read back from the account, the
// receipts turned into orders, the retrieval that declares what the instrument
// could not see — with no account, no key and nothing published. What it
// cannot prove is that Etsy answers as documented. That is the one thing left
// for a real connection, and it is named rather than simulated.
//
// THE FACT THIS EXISTS TO ESTABLISH: an order Etsy reported through a
// connection he granted is `venue_reported`, and one he typed off a statement
// is `owner_entered`. Same table, same column, different quality of evidence —
// and the difference decides what a silence means.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'c'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

/** Etsy's part, played by a double. Every shape is from its published v3 API. */
const LISTING_ID = '9988776655';

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
import { approveListing, seedProof2 } from '../../src/services/venture/proof-2.js';
import { readTheShop, bringTheVenueUpToDate, CANNOT_SEE } from '../../src/services/senses/readers/etsy-shop.js';

const OWNER = 'rv_owner';
let PRODUCT = '';
let X = '';

/**
 * The application key, placed as `setAppCredential` places it — encrypted, with
 * the verification Etsy gave — without the round trip to Etsy's ping.
 */
async function placeAppKey(): Promise<void> {
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4242', datetime('now'), 'test')
     ON CONFLICT(provider) DO UPDATE SET secret_json = excluded.secret_json, forgotten_at = NULL`,
    [encrypt(JSON.stringify({ keystring: 'test-keystring', sharedSecret: 'test-secret' }))]);
}

async function forgetAppKey(): Promise<void> {
  await query(
    `UPDATE app_credentials SET forgotten_at = datetime('now'), forget_reason = 'scenario'
      WHERE provider = 'etsy' AND forgotten_at IS NULL`);
}

/** A connection of the shape `completeAuthorization` writes, without the round trip. */
async function connect(scopes: string[]): Promise<string> {
  const senseId = nanoid();
  await query(
    `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
     VALUES (?,?,'revenue','etsy','real','read-only, for this test')`, [senseId, PRODUCT]);
  await query(
    `INSERT INTO sense_credentials
       (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
     VALUES (?,?,?,'etsy',?,?,?)`,
    [nanoid(), senseId, PRODUCT, JSON.stringify(scopes),
      encryptCredentialPayload(JSON.stringify({ access_token: 'tok', shop_id: '77770001' })),
      new Date(Date.now() + 3600_000).toISOString()]);
  return senseId;
}

/**
 * A CREDENTIAL IS REVOKED, NEVER DELETED, and the schema says so: a delete is
 * refused outright and a revocation must carry a reason and cannot be undone.
 * So each scenario revokes its own rather than wiping the table, which is also
 * how the owner's disconnect actually works.
 */
const forget = async (): Promise<void> => {
  await query(
    `UPDATE sense_credentials SET revoked_at = datetime('now'), revoke_reason = 'end of scenario'
      WHERE revoked_at IS NULL`);
  await query(
    `UPDATE company_senses SET disconnected_at = datetime('now'), disconnect_reason = 'end of scenario'
      WHERE disconnected_at IS NULL`);
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rv', 'thomas@example.com', 'Owner']);
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query(
    'SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await placeAppKey();
});

beforeEach(forget);

describe('every failure is an answer, never an empty result', () => {
  it('says no account is connected rather than reading nothing', async () => {
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    expect('failed' in r && r.ownerWords).toMatch(/no Etsy account is connected/);
  });

  it('says no application key has been placed rather than failing at the provider', async () => {
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await forgetAppKey();
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    await placeAppKey();
    expect('failed' in r && r.ownerWords).toMatch(/no Etsy application key/);
  });

  it('refuses a grant narrower than the one asked for, BEFORE reading', async () => {
    // A credential issued against fewer scopes fails at the third request
    // rather than the first — and by then the reading is half-taken and looks
    // like a shop with less in it than it has.
    await connect(['shops_r']);
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    expect('failed' in r && r.ownerWords).toMatch(/listings_r and transactions_r/);
  });
});

describe('the shop is read back from the account, never remembered', () => {
  it('names the shop the credential actually opens', async () => {
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    expect('failed' in r).toBe(false);
    if ('failed' in r) return;
    // The owner renamed this shop once already. What is recorded is what the
    // account says it is at the moment it is read.
    expect(r.shop.shopName).toBe('ApexMicro');
    expect(r.shop.shopId).toBe('77770001');
  });

  it('declares what the instrument could not see, in the retrieval', async () => {
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    if ('failed' in r) throw new Error('expected a reading');
    const row = (await query(
      'SELECT can_see, cannot_see FROM market_retrievals WHERE id = ?', [r.retrievalId]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.cannot_see)).toBe(CANNOT_SEE);
    // The permanent limit, named rather than engineered around.
    expect(String(row.cannot_see)).toMatch(/no shop-statistics endpoint/);
    expect(String(row.can_see)).toMatch(/receipts/);
  });
});

/** One receipt, as Etsy returns it. The ledger is append-only, so each
 *  scenario uses its own order number rather than clearing the last one. */
function receipt(id: string, opts: { listingId?: string; feeMinor?: number } = {}): void {
  ETSY['shops/77770001/receipts'] = {
    count: 1,
    results: [{
      receipt_id: id,
      is_paid: true,
      created_timestamp: Math.floor(Date.parse('2026-09-20T09:00:00Z') / 1000),
      grandtotal: { amount: 1400, divisor: 100, currency_code: 'USD' },
      // Etsy names the listing each line of the receipt is for. Without it a
      // shop-wide endpoint would file every other sale as this test's.
      //
      // AND THE LINE CARRIES ITS PRICE, which this fixture omitted and Etsy
      // never does. The omission mattered once the reader stopped taking
      // `grandtotal` as revenue: that total is what the buyer paid, including
      // the sales tax Etsy remits to a state, and the seller's revenue is the
      // lines. A double that answers less than the real provider does hides
      // exactly the field the correction depends on.
      transactions: [{
        listing_id: opts.listingId ?? LISTING_ID,
        quantity: 1,
        price: { amount: 1400, divisor: 100, currency_code: 'USD' },
      }],
    }],
  };
  ETSY[`shops/77770001/receipts/${id}/payments`] = {
    count: 1,
    results: [{ amount_fees: { amount: opts.feeMinor ?? 158, divisor: 100, currency_code: 'USD' } }],
  };
}

/** The exposure an order attaches to. The reading never creates one: placing a
 *  listing is not something this credential can do. */
async function listed(): Promise<void> {
  const { recordListing } = await import('../../src/services/venture/proof-2.js');
  await recordListing({ founderId: OWNER, experimentId: X,
    url: 'https://www.etsy.com/listing/9988776655/bid-decision-workbook' }).catch(() => undefined);
}

/**
 * THE SHAPE `settleFromTheWorld` WRITES WHEN A TEST SETTLES, without its
 * prediction machinery: this file plays only the venue, not the verdict, so
 * the sealed rows are written directly, the same way `connect()` above plays
 * the shape `completeAuthorization` writes without the round trip.
 */
async function settleTheTest(): Promise<void> {
  await query(
    `UPDATE venture_experiments SET ran_at = datetime('now'), verdict = 'as_predicted',
            what_happened = 'the workbook sold, as predicted' WHERE id = ?`, [X]);
  const { exposureOf, withdrawExposure } = await import('../../src/services/venture/outcome.js');
  const x = await exposureOf(X);
  if (x && x.withdrawnAt === null) await withdrawExposure(x.id);
}

describe('a silence is about orders and nothing else', () => {
  it('records an absence of orders, and claims nothing about attention', async () => {
    ETSY['shops/77770001/receipts'] = { count: 0, results: [] };
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    // LISTED FIRST, WHICH THIS FILE NEVER DID. `listed()` sat unused here and
    // every observation in it was therefore filed against a shop with nothing
    // of the test's in it for sale. An independent review found the reader
    // labelling that silence as evidence CONTRADICTING the claim that buyers
    // would pay; the reader now files nothing until the test is exposed, and
    // these assertions are about the state where an absence genuinely is an
    // answer — so the fixture has to put the test in that state.
    await listed();
    await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });

    const o = (await query(
      `SELECT saw, from_absence, retrieval_id FROM market_observations
        WHERE source LIKE 'etsy:shop:%' ORDER BY rowid DESC LIMIT 1`))
      .rows[0] as Record<string, unknown>;
    expect(Number(o.from_absence), 'no receipts IS evidence about orders').toBe(1);
    // And the observation carries the instrument that took it, so what the
    // instrument could not see travels with it.
    expect(o.retrieval_id).not.toBeNull();
    // THE SENTENCE THIS ONCE PINNED WAS FALSE, and a review caught both it and
    // this assertion holding it in place. Etsy reports no DAILY figures — and
    // it does report a listing's lifetime views, which this very reader
    // fetches. An overclaim of ignorance is as dishonest as an overclaim of
    // knowledge, and easier to miss.
    expect(String(o.saw)).toMatch(/no daily view, visit or impression counts/);
    expect(String(o.saw)).toMatch(/lifetime view and favourite counts are readable/);
  });
});

describe('an order Etsy reported is not an order he typed', () => {

  it('records it as venue_reported, which is the whole point of connecting', async () => {
    receipt('3312345678');
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();

    const out = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(out.read).toBe(true);
    if (!out.read) return;
    expect(out.orders).toBe(1);
    expect(out.recorded).toBe(1);

    const f = (await query(
      `SELECT observed_how, provider, amount_cents FROM experiment_fulfilments
        WHERE payment_ref = '3312345678'`)).rows[0] as Record<string, unknown>;
    expect(String(f.observed_how)).toBe('venue_reported');
    expect(String(f.provider)).toBe('etsy');
    expect(Number(f.amount_cents)).toBe(1400);
  });

  it('is idempotent, because the venue reports the same receipt every pass', async () => {
    receipt('3312345679');
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    const first = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(first.read && first.recorded, 'the first pass records it').toBe(1);
    const again = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(again.read && again.recorded, 'a second pass must add nothing').toBe(0);
    const n = (await query(
      `SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = '3312345679'`))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(1);
  });

  it('reads the fee Etsy kept, because transactions_r reaches it', async () => {
    // THIS TEST ASSERTED THE OPPOSITE, and the claim it pinned was false. The
    // code said the fee sat "behind a scope this connection does not hold";
    // `getShopPaymentByReceiptId` is under `transactions_r`, which the
    // connection holds — and migration 338 says so in the very reason the
    // owner is shown for granting it. The code was contradicting the
    // institution's own constitutional record, and two reviews found it.
    receipt('3312345680', { feeMinor: 158 });
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    const fee = (await query(
      `SELECT amount_cents FROM economic_events
        WHERE kind = 'provider_fee' AND provider = 'etsy' AND provider_ref = '3312345680:fees'`))
      .rows[0] as Record<string, unknown> | undefined;
    expect(fee, 'the fee is read, not left for him to type').toBeTruthy();
    expect(Number(fee!.amount_cents)).toBe(158);
  });

  it('still invents nothing when Etsy does not state a fee', async () => {
    receipt('3312345681');
    delete ETSY['shops/77770001/receipts/3312345681/payments'];
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    const fee = (await query(
      `SELECT COUNT(*) AS n FROM economic_events
        WHERE kind = 'provider_fee' AND provider_ref = '3312345681:fees'`))
      .rows[0] as Record<string, unknown>;
    // `recordVenueOrder` already accepts "not yet on the statement". A fee
    // invented here would be a cost nobody paid.
    expect(Number(fee.n)).toBe(0);
  });
});

// =============================================================================
// WHAT TWO INDEPENDENT REVIEWS FOUND IN THE FIRST VERSION OF THIS.
//
// The reading worked. What it claimed about the reading did not, in five
// separate ways — and every one of them was an evidential claim the institution
// would have carried permanently, because observations are immutable and
// fulfilments cannot be deleted.
// =============================================================================

describe('a shop-wide endpoint is not this experiment\'s evidence', () => {
  it('passes over a receipt for another listing in the same shop', async () => {
    // THE WORST OF THE FIVE. `receipts` is shop-wide, and this filed every
    // sale of every other thing the owner sells as THIS experiment's order —
    // a charge in its ledger, a delivered fulfilment, and, because
    // `settleFromTheWorld` counts events inside the exposure's window, a
    // sealed prediction settled `as_predicted` on somebody else's sale.
    receipt('9000000001', { listingId: '1111111111' });
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    const out = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(out.read).toBe(true);
    if (!out.read) return;
    expect(out.orders, 'another listing\'s sale is not this test\'s order').toBe(0);
    const n = (await query(
      `SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE payment_ref = '9000000001'`))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(0);
  });

  it('passes over an unpaid receipt even when Etsy returns one', async () => {
    // A receipt exists before the money does on Etsy's deferred methods. Taken
    // as paid, it writes revenue, a delivered obligation and refund exposure
    // for a sale that has not happened — with no path back, because a later
    // cancellation hits the duplicate branch and is ignored.
    receipt('9000000002');
    (ETSY['shops/77770001/receipts'] as { results: Array<Record<string, unknown>> })
      .results[0].is_paid = false;
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    const out = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(out.read && out.orders).toBe(0);
  });
});

describe('a partial read never becomes an absence', () => {
  it('knows it was truncated, and says so', async () => {
    // `limit=100` once, with no `offset` and no reading of `count`. A shop with
    // a hundred and one receipts read as a shop with a hundred — and an empty
    // list became an affirmative "nobody bought". The owner's rule, quoted in
    // the readiness module: "Do not use the absence of recorded events as
    // evidence of no external activity when the observation path was
    // unavailable." A path that cannot tell it was truncated is unavailable and
    // does not know it.
    ETSY['shops/77770001/receipts'] = { count: 250, results: [] };
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    if ('failed' in r) throw new Error('expected a reading');
    expect(r.saidOrders, 'the source\'s own count, which was thrown away before').toBe(250);
    expect(r.complete).toBe(false);
  });

  it('counts a receipt it could not parse as a discard, not as nothing', async () => {
    ETSY['shops/77770001/receipts'] = {
      count: 1,
      results: [{ receipt_id: '9000000003', is_paid: true, created_timestamp: 0, grandtotal: null,
        transactions: [{ listing_id: LISTING_ID }] }],
    };
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    const r = await readTheShop({
      founderId: OWNER, productId: PRODUCT, onlyListingId: LISTING_ID,
    });
    if ('failed' in r) throw new Error('expected a reading');
    expect(r.orders).toHaveLength(0);
    expect(r.discarded, 'a shape it could not read is not a shop with nothing in it').toBe(1);
    expect(r.complete).toBe(false);
  });
});

describe('what the reading bears on the claim, and how often it says so', () => {
  it('files an empty shop as contradicting the claim that people will pay', async () => {
    // An EXPOSED test whose shop is empty. Before exposure the reader files
    // nothing at all, because a shop with nothing in it for sale has not been
    // asked the question.
    await listed();
    // `bearing` was hard-coded to `supports` even when nothing sold — so
    // "nobody bought anything" accumulated as direct evidence FOR the claim.
    // Worse: the guard that lets a claim be narrowed requires a `contradicts`
    // observation, so the only mechanism that reads the venue could never
    // produce one, and the claim could never be narrowed by what the venue
    // said.
    const o = (await query(
      `SELECT bearing, from_absence FROM market_observations
        WHERE source LIKE 'etsy:shop:%' ORDER BY rowid ASC LIMIT 1`))
      .rows[0] as Record<string, unknown>;
    expect(String(o.bearing)).toBe('contradicts');
    expect(Number(o.from_absence)).toBe(1);
  });

  it('writes one observation for a day, not one for every tick', async () => {
    // `observe` does not deduplicate and nothing constrains `source`, so the
    // hourly pass wrote a fresh immutable row every tick: twenty-four a day,
    // each counted by `standingOf` as direct supporting evidence and by the
    // readiness reader as "readings taken from Etsy itself". The job running is
    // not evidence.
    const n = (await query(
      `SELECT COUNT(*) AS n FROM market_observations WHERE source LIKE 'etsy:shop:%'`))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n), 'many passes, one day, one reading').toBe(1);
  });
});

// =============================================================================
// A LISTING OUTLIVES ITS EXPERIMENT (migration 350).
//
// Every scenario above proves this reader is thorough. None of them ever
// settles the test and reads the venue again — which is exactly why the seam
// below went unnoticed: `settleListings` withdraws the Foundry exposure the
// moment a test settles, and the experiment then drops out of
// `listingExperimentsToRead` for ever. A stranger can still pay the listing
// after that; this is the one place that fact used to go to die.
//
// DELIBERATELY RUNS LAST IN THIS FILE. It settles the shared experiment `X`,
// which `venture_experiment:already_run` then makes irreversible for the rest
// of the suite.
// =============================================================================
describe('a listing outlives its experiment', () => {
  it('keeps reading a settled listing, never folds a later order into the sealed test, and raises it once', async () => {
    // ORDER A closes the trial.
    receipt('7700000001');
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    const first = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(first.read && first.recorded, 'A is recorded normally, before settlement').toBe(1);

    await settleTheTest();
    const sealedBefore = (await query(
      `SELECT ran_at, verdict, what_happened FROM venture_experiments WHERE id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    const fulfilmentsBefore = (await query(
      `SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?`, [X]))
      .rows[0] as Record<string, unknown>;

    // ORDER B, for the SAME still-live listing, after the trial closed.
    receipt('7700000002');
    const second = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(second.read, 'the venue is still read after its experiment has settled').toBe(true);
    if (!second.read) return;
    // B is not folded into the ledger: the sealed prediction may not be
    // written to again, so `recordVenueOrder` still refuses it.
    expect(second.recorded, 'B is not written as a charge under a concluded prediction').toBe(0);

    // But a refusal caught and forgotten is a real sale nobody ever sees. B is
    // a durable, owner-visible fact instead.
    const incident = (await query(
      `SELECT founder_id, experiment_id, product_id, gross_cents, currency, resolved_at
         FROM venue_orders_after_settlement WHERE provider = 'etsy' AND order_ref = '7700000002'`))
      .rows[0] as Record<string, unknown> | undefined;
    expect(incident, 'the second order is surfaced, not silently dropped').toBeTruthy();
    expect(String(incident!.founder_id)).toBe(OWNER);
    expect(String(incident!.experiment_id)).toBe(X);
    expect(Number(incident!.gross_cents)).toBe(1400);
    expect(incident!.resolved_at).toBeNull();

    // A's own sealed prediction and evidence counts are untouched — B did not
    // rewrite them.
    const sealedAfter = (await query(
      `SELECT ran_at, verdict, what_happened FROM venture_experiments WHERE id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(sealedAfter).toEqual(sealedBefore);
    const fulfilmentsAfter = (await query(
      `SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(fulfilmentsAfter.n).toEqual(fulfilmentsBefore.n);

    // A repeated read of the same unresolved receipt raises it once, not once
    // an hour for as long as it goes unresolved.
    const third = await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    expect(third.read).toBe(true);
    const n = (await query(
      `SELECT COUNT(*) AS n FROM venue_orders_after_settlement WHERE provider = 'etsy' AND order_ref = '7700000002'`))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n), 'many passes, one incident').toBe(1);

    // AND THE ABSENCE HORIZON STOPS DESCRIBING THIS AS CALM. `truthful` asks
    // whether silence would be mistaken for calm; a paid order at a venue
    // nothing here has reconciled is exactly that silence.
    const { absenceReading } = await import('../../src/services/institution/absence-test.js');
    const reading = await absenceReading(OWNER, 7, new Date());
    const truth = reading.properties.find((p) => p.property === 'truthful');
    expect(truth, 'the truthful property is read').toBeTruthy();
    expect(truth!.evidence.join(' ')).toContain('7700000002');
    expect(truth!.evidence.join(' ')).toContain('already settled');
    expect(truth!.wouldFixIt.join(' ')).toContain('bring it under the continuing asset');

    // WHAT THIS DOES NOT YET PROVE. B is not recorded under the continuing
    // asset — no charge, no fee, no obligation — because that asset-scoped
    // intake path is its own, larger piece of work and is not built here. A
    // fee correction or a refund on B has nothing to attach to yet for the
    // same reason. Proof debt, named rather than hidden.
  });

  it('watches a settled listing while its asset is active, and stops once the asset is retired', async () => {
    // X was settled by the previous test; this is the selection the hourly
    // job actually calls (`settledListingsStillLive`), not a direct read —
    // proving the job would still find this listing to read at all, which the
    // test above (calling `bringTheVenueUpToDate` directly) does not.
    const { settledListingsStillLive } = await import('../../src/services/senses/readers/etsy-shop.js');
    const stillWatched = await settledListingsStillLive();
    expect(stillWatched.some((r) => r.experimentId === X),
      'a settled listing whose asset is still active is still watched').toBe(true);

    // THE OWNER'S OWN ACT — retiring the asset — is what stops it, not a
    // guessed time window. Written directly, the shape `retireExperimentalAsset`
    // writes, without its open-obligation guard: that guard is its own
    // function's business, not this predicate's.
    await query(
      `UPDATE products SET status = 'archived', retired_because = 'the owner took the listing down'
        WHERE id = ?`, [PRODUCT]);
    const afterRetirement = await settledListingsStillLive();
    expect(afterRetirement.some((r) => r.experimentId === X),
      'a retired asset is not watched for ever').toBe(false);
  });
});
