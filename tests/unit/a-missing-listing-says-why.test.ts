// =============================================================================
// LAW (Roadmap 2027 R34): A LISTING THE SHOP DOES NOT SHOW SAYS WHY.
//
// The shop's listing read returns active listings only, so a listing that
// expired, sold out, was deactivated or was never published read exactly like
// one that was deleted, and the owner was told it "may have expired, sold out
// or been deactivated". When a complete read does not include the test's
// listing, the reader now asks Etsy for that listing (read scope, already
// granted), keeps the state Etsy gives it beside the reading, and readiness
// names the one fix. A listing Etsy does not have, or has in another shop, is
// "gone". When Etsy does not answer, the reason is unread, not guessed, and a
// reason already known is not erased by a pass that could not read it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'why@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const LISTING = 9988776659;
/** What Etsy shows: the listing at a price, absent, or a count that says more than it returned. */
let shows: { priceCents: number } | 'absent' | 'truncated' = { priceCents: 1400 };
/** The files Etsy holds on the listing; undefined answers 404 like an endpoint nobody asked of this double. */
let files: Array<{ filename: string; size_bytes: number }> | 'refused' | undefined;
/** What Etsy says of the one listing when asked for it by number. */
let one: { state: string; shop_id?: number } | 404 | 500 = 404;
let askedForOne = 0;
vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async (url: string) => {
    const path = url.replace('https://openapi.etsy.com/v3/application/', '').split('?')[0];
    const listing = typeof shows === 'object' ? {
      listing_id: LISTING, title: 'Bid Decision Workbook', state: 'active', views: 3, num_favorers: 0,
      url: `https://www.etsy.com/listing/${String(LISTING)}/workbook`,
      price: { amount: shows.priceCents, divisor: 100, currency_code: 'USD' },
    } : null;
    const bodies: Record<string, unknown> = {
      'users/me': { user_id: 44, shop_id: 77770003 },
      'shops/77770003': { shop_id: 77770003, shop_name: 'ApexMicro', url: 'https://www.etsy.com/shop/ApexMicro', is_vacation: false },
      'shops/77770003/listings': shows === 'truncated' ? { count: 7, results: [] }
        : { count: listing ? 1 : 0, results: listing ? [listing] : [] },
      'shops/77770003/receipts': { count: 0, results: [] },
    };
    if (path === `shops/77770003/listings/${String(LISTING)}/files`) {
      if (files === 'refused') return { ok: false, status: 403, json: async () => ({}) };
      if (files !== undefined) return { ok: true, status: 200, json: async () => ({ count: files.length, results: files }) };
    }
    if (path === `listings/${String(LISTING)}`) {
      askedForOne += 1;
      if (one === 404 || one === 500) return { ok: false, status: one, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ listing_id: LISTING, shop_id: 77770003, ...(one as object) }) };
    }
    const body = bodies[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }),
  assertUrlSafe: vi.fn(async (u: string) => new URL(u)),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encrypt, encryptCredentialPayload } from '../../src/services/encryption.js';
import { approveListing, PROOF2_WINDOW_DAYS, recordListing, seedProof2, settleListings } from '../../src/services/venture/proof-2.js';
import { bringTheVenueUpToDate } from '../../src/services/senses/readers/etsy-shop.js';
import { qualificationOf } from '../../src/services/venture/qualification.js';

const OWNER = 'why_owner';
const NAME = 'the listing Etsy shows is the offer that was sealed';
let X = '';
let PRODUCT = '';

const read = () => bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
const condition = async () => (await qualificationOf(X)).conditions.find((c) => c.name === NAME);
const log = async () => (await query(
  `SELECT seen, price_cents FROM venue_listing_readings WHERE product_id = ? ORDER BY rowid`, [PRODUCT]))
  .rows as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_why', 'why@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4646', datetime('now'), 'test')`,
    [encrypt(JSON.stringify({ keystring: 'test-keystring', sharedSecret: 'test-secret' }))]);
  const senseId = nanoid();
  await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_label)
     VALUES (?,?,'revenue','etsy','real','read-only, for this test','ApexMicro')`, [senseId, PRODUCT]);
  await query(
    `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
     VALUES (?,?,?,'etsy',?,?,?)`,
    [nanoid(), senseId, PRODUCT, JSON.stringify(['shops_r', 'listings_r', 'transactions_r']),
      encryptCredentialPayload(JSON.stringify({ access_token: 'tok', shop_id: '77770003' })),
      new Date(Date.now() + 3600_000).toISOString()]);
  await recordListing({ founderId: OWNER, experimentId: X, url: `https://www.etsy.com/listing/${String(LISTING)}/bid-decision-workbook` });
});


const reason = async () => String((await condition())?.because ?? '');
const states = async () => (await query(
  `SELECT seen, state FROM venue_listing_readings WHERE product_id = ? ORDER BY rowid`, [PRODUCT]))
  .rows.map((r) => [Number((r as Record<string, unknown>).seen), (r as Record<string, unknown>).state ?? null]);

describe('a listing the shop shows is not asked about', () => {
  it('reads the shop and makes no extra request', async () => {
    shows = { priceCents: 1400 };
    await read();
    expect(askedForOne).toBe(0);
    expect(await states()).toEqual([[1, null]]);
  });
});

describe('a listing the shop does not show says why', () => {
  it('expired: renew it', async () => {
    shows = 'absent'; one = { state: 'expired' };
    await read();
    expect(askedForOne).toBe(1);
    expect(await reason()).toMatch(/not among .*active listings.*says it has expired; renew it/);
  });
  it('sold out, deactivated, a draft: each names its own fix, and each change is kept', async () => {
    one = { state: 'sold_out' }; await read();
    expect(await reason()).toMatch(/sold out; raise its quantity/);
    one = { state: 'inactive' }; await read();
    expect(await reason()).toMatch(/deactivated; activate it/);
    one = { state: 'draft' }; await read();
    expect(await reason()).toMatch(/draft that was never published; publish it/);
    expect(await states()).toEqual([[1, null], [0, 'expired'], [0, 'sold_out'], [0, 'inactive'], [0, 'draft']]);
  });
  it('Etsy has no such listing, or has it in somebody else\'s shop: gone', async () => {
    one = { state: 'active', shop_id: 12345 }; await read();
    expect(await reason()).toMatch(/no listing by that number in this shop/);
    one = 404; await read();
    expect(await reason()).toMatch(/no listing by that number in this shop/);
    expect((await states()).at(-1)).toEqual([0, 'gone']);
  });
  it('Etsy not answering leaves the known reason standing rather than guessing', async () => {
    one = { state: 'expired' }; await read();
    const before = (await states()).length;
    one = 500; await read();
    expect((await states()).length).toBe(before);
    expect(await reason()).toMatch(/has expired; renew it/);
  });
});

describe('a read that did not reach the whole shop asks nothing', () => {
  it('concludes nothing and makes no extra request', async () => {
    const asked = askedForOne;
    shows = 'truncated';
    await read();
    expect(askedForOne).toBe(asked);
  });
});

describe('the column cannot carry anything but a state word', () => {
  it('refuses free text', async () => {
    await expect(query(`INSERT INTO venue_listing_readings (id, product_id, provider, listing_id, seen, state)
      VALUES ('bad','${'p'}','etsy','1',0,'Expired; DROP')`, [])).rejects.toThrow();
  });
});
