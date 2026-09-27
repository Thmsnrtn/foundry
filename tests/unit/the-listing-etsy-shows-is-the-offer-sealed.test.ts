// =============================================================================
// THE LISTING ETSY SHOWS IS THE OFFER THAT WAS SEALED — OR THE TEST SAYS NOT.
//
// Roadmap B2. A listing test seals a prediction about ONE offer: this file, at
// this price. The owner places the listing himself, by hand, on Etsy, and
// pastes its address. Nothing checked that what Etsy then shows is the offer
// the prediction was about. A workbook listed at $19 instead of $14, or a
// listing that expired and dropped out of the shop, tests something else or
// nothing — and a silent window would still have been read as the market's
// answer to the sealed offer.
//
// What has to hold, read from Etsy on each pass:
//   · the listing is among the shop's active listings, at the sealed price;
//   · a different price, or a listing Etsy no longer shows, stops the test
//     being ready and says exactly what differs;
//   · "not shown" is concluded only from a COMPLETE read — a truncated read
//     that did not reach it proves nothing;
//   · what Etsy showed is kept as a change log, and nothing rewrites it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '2'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'ls@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const LISTING = 9988776659;
/** What Etsy shows: the listing at a price, absent, or a count that says more than it returned. */
let shows: { priceCents: number } | 'absent' | 'truncated' = { priceCents: 1400 };
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
    const body = bodies[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }),
  assertUrlSafe: vi.fn(async (u: string) => new URL(u)),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encrypt, encryptCredentialPayload } from '../../src/services/encryption.js';
import { approveListing, recordListing, seedProof2 } from '../../src/services/venture/proof-2.js';
import { bringTheVenueUpToDate } from '../../src/services/senses/readers/etsy-shop.js';
import { qualificationOf } from '../../src/services/venture/qualification.js';

const OWNER = 'ls_owner';
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
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ls', 'ls@example.com', 'Owner']);
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

describe('before Etsy has been read', () => {
  it('claims nothing about the listing either way', async () => {
    expect(await condition()).toBeUndefined();
  });
});

describe('Etsy shows the sealed offer', () => {
  it('is met: active, at the price the test was sealed at', async () => {
    shows = { priceCents: 1400 };
    expect((await read()).read).toBe(true);
    const c = (await condition())!;
    expect(c.verdict).toBe('met');
    expect(c.because).toMatch(/\$14\.00/);
    expect((await log()).map((r) => [Number(r.seen), r.price_cents == null ? null : Number(r.price_cents)])).toEqual([[1, 1400]]);
  });

  it('reads the same thing again as no new fact', async () => {
    await read();
    expect((await log()).length).toBe(1);
  });
});

describe('Etsy shows something else', () => {
  it('stops the test at a different price, naming both', async () => {
    shows = { priceCents: 1900 };
    await read();
    const c = (await condition())!;
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toMatch(/\$19\.00/);
    expect(c.because).toMatch(/\$14\.00/);
    expect((await qualificationOf(X)).state).toBe('needs_external_account');
  });

  it('stops the test when Etsy no longer shows the listing among the shop\'s active ones', async () => {
    shows = 'absent';
    await read();
    const c = (await condition())!;
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toMatch(/not among .*active listings/);
  });

  it('concludes nothing from a read that did not reach the whole shop', async () => {
    const before = (await log()).length;
    shows = 'truncated';
    await read();
    expect((await log()).length).toBe(before);
  });

  it('keeps what Etsy showed as read: nothing rewrites it', async () => {
    await expect(query(`UPDATE venue_listing_readings SET price_cents = 1400 WHERE product_id = ?`, [PRODUCT]))
      .rejects.toThrow(/read_is_read/);
  });
});

describe('Etsy shows the sealed offer again', () => {
  it('is met again', async () => {
    shows = { priceCents: 1400 };
    await read();
    expect((await condition())!.verdict).toBe('met');
    expect((await log()).map((r) => Number(r.seen))).toEqual([1, 1, 0, 1]);
  });
});
