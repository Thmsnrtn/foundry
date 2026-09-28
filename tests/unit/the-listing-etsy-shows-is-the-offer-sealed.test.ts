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
/** The files Etsy holds on the listing; undefined answers 404 like an endpoint nobody asked of this double. */
let files: Array<{ filename: string; size_bytes: number }> | 'refused' | undefined;
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

describe('the file a buyer would download', () => {
  const FILE = 'the file on the listing is the one Foundry built';
  const fileCondition = async () => (await qualificationOf(X)).conditions.find((c) => c.name === FILE);
  const fileRows = async () => Number(((await query(
    `SELECT COUNT(*) AS n FROM venue_listing_readings WHERE product_id = ? AND files_json IS NOT NULL`, [PRODUCT]))
    .rows[0] as Record<string, unknown>).n);

  it('claims nothing while the files have not been read', async () => {
    expect(await fileCondition()).toBeUndefined();
  });

  it('is met when the listing carries the workbook Foundry built, by its size', async () => {
    shows = { priceCents: 1400 };
    files = [{ filename: 'bid-decision-workbook.xlsx', size_bytes: 48303 }];
    await read();
    const c = (await fileCondition())!;
    expect(c.verdict).toBe('met');
    expect(c.because).toMatch(/48,303 bytes/);
  });

  it('stops the test when no file is attached: a buyer would pay and get nothing', async () => {
    files = [];
    await read();
    const c = (await fileCondition())!;
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toMatch(/get nothing/);
    expect((await qualificationOf(X)).state).toBe('needs_external_account');
  });

  it('stops the test on a different file, naming both sizes', async () => {
    files = [{ filename: 'bid-workbook-old.xlsx', size_bytes: 41000 }];
    await read();
    const c = (await fileCondition())!;
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toMatch(/41,000 bytes/);
    expect(c.because).toMatch(/48,303 bytes/);
  });

  it('concludes nothing from a refused file read, and the price check still stands', async () => {
    const before = await fileRows();
    files = 'refused';
    await read();
    expect(await fileRows()).toBe(before);
    expect((await fileCondition())!.because).toMatch(/41,000 bytes/);
    expect((await condition())!.verdict).toBe('met');
  });

  it('keeps the file log change-only, and nothing rewrites it', async () => {
    files = [{ filename: 'bid-workbook-old.xlsx', size_bytes: 41000 }];
    const before = await fileRows();
    await read();
    expect(await fileRows()).toBe(before);
    await expect(query(`UPDATE venue_listing_readings SET files_json = '[]' WHERE product_id = ?`, [PRODUCT]))
      .rejects.toThrow(/read_is_read/);
    files = [{ filename: 'bid-decision-workbook.xlsx', size_bytes: 48303 }];
    await read();
    expect((await fileCondition())!.verdict).toBe('met');
  });
});

describe('what Etsy last showed, in one place on the connection page', () => {
  it('gathers each listing test\'s venue checks, as readiness words them, and when the permission ends', async () => {
    const { whatTheVenueLastShowed } = await import('../../src/services/venture/qualification.js');
    const shown = await whatTheVenueLastShowed(OWNER, 'etsy');
    expect(shown.listings).toHaveLength(1);
    const names = shown.listings[0].checks.map((c) => c.name);
    expect(names).toContain(NAME);
    expect(names).toContain('the file on the listing is the one Foundry built');
    expect(names).toContain('what the venue reports can be read');
    // Exactly what readiness says, not a second wording of it.
    const q = (await qualificationOf(X)).conditions.find((c) => c.name === NAME)!;
    expect(shown.listings[0].checks.find((c) => c.name === NAME)!.because).toBe(q.because);
    expect(shown.permissionEnds).toBeNull();
  });

  it('is on the connection page once the shop is his', async () => {
    await query(`UPDATE company_senses SET provider_account_ref = '77770003', identity_verified_at = datetime('now'),
      identity_confirmed_at = datetime('now'), identity_confirmed_by = ? WHERE product_id = ?`, [`founder:${OWNER}`, PRODUCT]);
    const { Hono } = await import('hono');
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'ls@example.com' } as never); await next(); });
    app.route('/', foundryShellRoutes);
    const text = (await (await app.request('https://f.test/foundry/controls/connectors/etsy')).text())
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('What Etsy last showed');
    expect(text).toMatch(new RegExp(`listing ${String(LISTING)}`));
    expect(text).toMatch(/48,303 bytes/);
    expect(text).toMatch(/Permission to read: end date not recorded/);
  });
});

describe('a new grant does not inherit what an earlier one read', () => {
  // Roadmap G4. Every grant — another shop, or other permissions on this one —
  // is a new credential. Readiness rests only on what was read through the
  // connection there is now; the first read after it is always written, even
  // when it sees what the last connection saw.
  const FILE = 'the file on the listing is the one Foundry built';
  const READABLE = 'what the venue reports can be read';
  const named = async (n: string) => (await qualificationOf(X)).conditions.find((c) => c.name === n);

  it('stops resting on the old reads the moment the connection is granted again', async () => {
    shows = { priceCents: 1400 };
    files = [{ filename: 'bid-decision-workbook.xlsx', size_bytes: 48303 }];
    await read();
    expect((await named(NAME))!.verdict).toBe('met');
    expect((await named(FILE))!.verdict).toBe('met');
    expect((await named(READABLE))!.verdict).toBe('met');

    // A second apart, so the new grant is unambiguously after the last read.
    await new Promise((r) => setTimeout(r, 1100));
    const sense = String(((await query(`SELECT company_sense_id AS s FROM sense_credentials WHERE product_id = ? AND revoked_at IS NULL`,
      [PRODUCT])).rows[0] as Record<string, unknown>).s);
    await query(`UPDATE sense_credentials SET revoked_at = datetime('now'), revoke_reason = 'granted again' WHERE product_id = ? AND revoked_at IS NULL`, [PRODUCT]);
    await query(
      `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
       VALUES (?,?,?,'etsy',?,?,?)`,
      [nanoid(), sense, PRODUCT, JSON.stringify(['shops_r', 'listings_r', 'transactions_r']),
        encryptCredentialPayload(JSON.stringify({ access_token: 'tok2', shop_id: '77770003' })),
        new Date(Date.now() + 3600_000).toISOString()]);

    expect(await named(NAME)).toBeUndefined();
    expect(await named(FILE)).toBeUndefined();
    const r = (await named(READABLE))!;
    expect(r.verdict).not.toBe('met');
    expect(r.because).toMatch(/connected again .* has not been read through that connection yet/);
    expect((await qualificationOf(X)).state).not.toBe('ready');
  });

  it('is met again once the new connection has read the same thing', async () => {
    await read();
    expect((await named(NAME))!.verdict).toBe('met');
    expect((await named(FILE))!.verdict).toBe('met');
    expect((await named(READABLE))!.verdict).toBe('met');
  });
});

describe('a window in which Etsy showed another offer is not a verdict', () => {
  it('voids the silence of a window during which the listing was at another price', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    await query(`UPDATE experiment_exposures SET placed_at = datetime('now', ?) WHERE experiment_id = ?`,
      [`-${String(PROOF2_WINDOW_DAYS + 1)} days`, X]);
    // Read, part-way through the window, at $19 — and later back at $14.
    await query(`INSERT INTO venue_listing_readings (id, product_id, provider, listing_id, seen, price_cents, currency, observed_at)
      VALUES (?,?,'etsy',?,1,1900,'usd',datetime('now','-20 days'))`, [nanoid(), PRODUCT, String(LISTING)]);
    await query(`INSERT INTO venue_listing_readings (id, product_id, provider, listing_id, seen, price_cents, currency, observed_at)
      VALUES (?,?,'etsy',?,1,1400,'usd',datetime('now','-10 days'))`, [nanoid(), PRODUCT, String(LISTING)]);
    const [r] = await settleListings({ founderId: OWNER, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.settled).toBeNull();
    const e = (await query('SELECT validity, invalid_because, verdict FROM venture_experiments WHERE id = ?', [X]))
      .rows[0] as Record<string, unknown>;
    expect(e.validity).toBe('invalid');
    expect(e.invalid_because).toBe('offer_not_published');
    expect(e.verdict).toBeNull();
    expect(r.because).toMatch(/\$19\.00/);
    expect(r.because).toMatch(/sealed at \$14\.00/);
  });
});

