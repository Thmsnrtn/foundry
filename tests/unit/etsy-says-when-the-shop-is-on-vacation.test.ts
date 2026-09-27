// =============================================================================
// ETSY SAYS WHEN THE SHOP IS ON VACATION, AND THAT IS READ.
//
// Whether buyers can find the shop was, until now, only ever the owner's word
// (`findability.ts`), because nothing the reader asked Etsy could answer it.
// That was half true. Etsy's shop resource carries `is_vacation`: a shop on
// vacation takes no orders, and the reader was fetching that resource on every
// read and throwing the field away. Developer Mode — what actually hid
// ApexMicro on 25 September 2026 — is NOT reported to apps, so his word stays
// the only witness of that, and this does not replace it.
//
// What has to hold:
//   · a read records what Etsy said about vacation, when it said it;
//   · a field Etsy did not send is not "not on vacation" — no reading at all;
//   · a shop Etsy reports on vacation is not ready for a test, whatever he last
//     said, and the reason names Etsy as the one saying it;
//   · a window that overlapped a vacation Etsy reported is not a verdict;
//   · the same state read again is not a new fact, and nothing rewrites one;
//   · when Etsy reports the vacation over, his word decides again.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'f'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'vac@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

/** Etsy's part, played by a double whose shop can go on vacation. */
let vacation: boolean | undefined = false;
vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async (url: string) => {
    const path = url.replace('https://openapi.etsy.com/v3/application/', '').split('?')[0];
    const shop: Record<string, unknown> = { shop_id: 77770002, shop_name: 'ApexMicro', url: 'https://www.etsy.com/shop/ApexMicro' };
    if (vacation !== undefined) shop.is_vacation = vacation;
    const bodies: Record<string, unknown> = {
      'users/me': { user_id: 43, shop_id: 77770002 },
      'shops/77770002': shop,
      'shops/77770002/listings': { count: 0, results: [] },
      'shops/77770002/receipts': { count: 0, results: [] },
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
import { sayWhetherFindable, shopHiddenDuring, venueSaysOnVacation } from '../../src/services/venture/findability.js';

const OWNER = 'vac_owner';
let X = '';
let PRODUCT = '';

const read = () => bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
const findCondition = async () => (await qualificationOf(X)).conditions.find((c) => c.name === 'buyers can find the shop')!;
const readings = async () => (await query(
  `SELECT on_vacation FROM venue_visibility_readings WHERE product_id = ? ORDER BY rowid`, [PRODUCT]))
  .rows as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_vac', 'vac@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4343', datetime('now'), 'test')`,
    [encrypt(JSON.stringify({ keystring: 'test-keystring', sharedSecret: 'test-secret' }))]);
  const senseId = nanoid();
  // The connection names the shop it opens, as recognition records it.
  await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_label)
     VALUES (?,?,'revenue','etsy','real','read-only, for this test','ApexMicro')`, [senseId, PRODUCT]);
  await query(
    `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
     VALUES (?,?,?,'etsy',?,?,?)`,
    [nanoid(), senseId, PRODUCT, JSON.stringify(['shops_r', 'listings_r', 'transactions_r']),
      encryptCredentialPayload(JSON.stringify({ access_token: 'tok', shop_id: '77770002' })),
      new Date(Date.now() + 3600_000).toISOString()]);
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776656/workbook' });
  await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: true, saidBy: `founder:${OWNER}` });
});

describe('a field Etsy did not send', () => {
  it('is no reading at all, not "open"', async () => {
    vacation = undefined;
    expect((await read()).read).toBe(true);
    expect(await readings()).toEqual([]);
    expect(await venueSaysOnVacation(PRODUCT, 'etsy')).toBeNull();
    expect((await findCondition()).verdict).toBe('met');
  });
});

describe('Etsy reports the shop open', () => {
  it('records it as Etsy\'s, and his word still decides', async () => {
    vacation = false;
    expect((await read()).read).toBe(true);
    expect((await readings()).map((r) => Number(r.on_vacation))).toEqual([0]);
    expect((await findCondition()).verdict).toBe('met');
  });

  it('does not record the same state twice', async () => {
    await read();
    expect((await readings()).length).toBe(1);
  });
});

describe('Etsy reports the shop on vacation', () => {
  it('stops the test being ready, whatever he last said, and says who says so', async () => {
    vacation = true;
    await read();
    expect((await readings()).map((r) => Number(r.on_vacation))).toEqual([0, 1]);
    const said = await venueSaysOnVacation(PRODUCT, 'etsy');
    expect(said?.onVacation).toBe(true);
    const c = await findCondition();
    expect(c.verdict).toBe('waits_for_you');
    expect(c.because).toMatch(/Etsy itself reports ApexMicro is on vacation/);
    expect(c.because).toMatch(/turn vacation mode off/);
  });

  it('makes a window that overlapped it no verdict', async () => {
    const s = await shopHiddenDuring(X, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    expect(s).toMatch(/Etsy reported ApexMicro on vacation/);
  });

  it('is kept as read: nothing rewrites it', async () => {
    await expect(query(`UPDATE venue_visibility_readings SET on_vacation = 0 WHERE product_id = ?`, [PRODUCT]))
      .rejects.toThrow(/read_is_read/);
  });
});

describe('Etsy reports the vacation over', () => {
  it('lets his word decide again', async () => {
    vacation = false;
    await read();
    expect((await readings()).map((r) => Number(r.on_vacation))).toEqual([0, 1, 0]);
    expect((await findCondition()).verdict).toBe('met');
  });

  it('a window wholly after it is not called hidden', async () => {
    const s = await shopHiddenDuring(X, new Date(Date.now() + 60_000), new Date(Date.now() + 86_400_000));
    expect(s).toBeNull();
  });
});
