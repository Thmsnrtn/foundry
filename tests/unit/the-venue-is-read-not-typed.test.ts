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
process.env.ETSY_API_KEY = 'test-app-key';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

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
import { encryptCredentialPayload } from '../../src/services/encryption.js';
import { approveListing, seedProof2 } from '../../src/services/venture/proof-2.js';
import { readTheShop, bringTheVenueUpToDate, CANNOT_SEE } from '../../src/services/senses/readers/etsy-shop.js';

const OWNER = 'rv_owner';
let PRODUCT = '';
let X = '';

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
});

beforeEach(forget);

describe('every failure is an answer, never an empty result', () => {
  it('says no account is connected rather than reading nothing', async () => {
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    expect('failed' in r && r.ownerWords).toMatch(/no Etsy account is connected/);
  });

  it('says the deployment has no app rather than failing at the provider', async () => {
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    const key = process.env.ETSY_API_KEY;
    delete process.env.ETSY_API_KEY;
    const r = await readTheShop({ founderId: OWNER, productId: PRODUCT });
    process.env.ETSY_API_KEY = key;
    expect('failed' in r && r.ownerWords).toMatch(/no Etsy app registered/);
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
function receipt(id: string): void {
  ETSY['shops/77770001/receipts'] = {
    count: 1,
    results: [{
      receipt_id: id,
      created_timestamp: Math.floor(Date.parse('2026-09-20T09:00:00Z') / 1000),
      grandtotal: { amount: 1400, divisor: 100, currency_code: 'USD' },
    }],
  };
}

/** The exposure an order attaches to. The reading never creates one: placing a
 *  listing is not something this credential can do. */
async function listed(): Promise<void> {
  const { recordListing } = await import('../../src/services/venture/proof-2.js');
  await recordListing({ founderId: OWNER, experimentId: X,
    url: 'https://www.etsy.com/listing/9988776655/bid-decision-workbook' }).catch(() => undefined);
}

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

  it('invents no fee, because Etsy does not state one on a receipt', async () => {
    receipt('3312345680');
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await listed();
    await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
    const fee = (await query(
      `SELECT COUNT(*) AS n FROM economic_events WHERE kind = 'provider_fee' AND provider = 'etsy'`))
      .rows[0] as Record<string, unknown>;
    // A fee invented here would be a cost nobody paid.
    expect(Number(fee.n)).toBe(0);
  });
});

describe('a silence is about orders and nothing else', () => {
  it('records an absence of orders, and claims nothing about attention', async () => {
    ETSY['shops/77770001/receipts'] = { count: 0, results: [] };
    await connect(['shops_r', 'listings_r', 'transactions_r']);
    await bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });

    const o = (await query(
      `SELECT saw, from_absence, retrieval_id FROM market_observations
        WHERE source LIKE 'etsy:shop:%' ORDER BY rowid DESC LIMIT 1`))
      .rows[0] as Record<string, unknown>;
    expect(Number(o.from_absence), 'no receipts IS evidence about orders').toBe(1);
    // And the observation carries the instrument that took it, so what the
    // instrument could not see travels with it.
    expect(o.retrieval_id).not.toBeNull();
    expect(String(o.saw)).toMatch(/reports no view, visit or impression counts/);
  });
});
