// =============================================================================
// WHEN ETSY ASKS FOUNDRY TO WAIT, FOUNDRY WAITS — AND CONCLUDES NOTHING MEANWHILE.
//
// Roadmap B5. A 429 from Etsy is not a broken connection: it is the venue
// saying "not so often". It was handled exactly like one — "Etsy could not be
// read: Etsy answered 429" — and the next pass asked again at once, and the
// one after that, each asking a venue that had just said to stop.
//
// What has to hold:
//   · the owner is told Etsy asked to wait, and until when, in those words;
//   · no read is attempted before then: the next pass does not touch Etsy;
//   · the silence meanwhile is still NOT evidence — the connection reads as
//     not read, so readiness and settlement wait exactly as for any failed read;
//   · Etsy's own Retry-After is honoured, a missing one waits a minute, and an
//     absurd one is capped at a day;
//   · once the wait is over the next read goes ahead, and a good read clears it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'wait@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

/** Whether Etsy is rate-limiting, and the Retry-After it sends (undefined: none). */
let limited = false;
let retryAfter: string | undefined = '120';
let calls = 0;
vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async (url: string) => {
    calls++;
    if (limited) {
      return { ok: false, status: 429, json: async () => ({}),
        headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) } };
    }
    const path = url.replace('https://openapi.etsy.com/v3/application/', '').split('?')[0];
    const bodies: Record<string, unknown> = {
      'users/me': { user_id: 45, shop_id: 77770005 },
      'shops/77770005': { shop_id: 77770005, shop_name: 'ApexMicro', url: 'https://www.etsy.com/shop/ApexMicro', is_vacation: false },
      'shops/77770005/listings': { count: 0, results: [] },
      'shops/77770005/receipts': { count: 0, results: [] },
    };
    const body = bodies[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
  }),
  assertUrlSafe: vi.fn(async (u: string) => new URL(u)),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encrypt, encryptCredentialPayload } from '../../src/services/encryption.js';
import { approveListing, seedProof2 } from '../../src/services/venture/proof-2.js';
import { bringTheVenueUpToDate } from '../../src/services/senses/readers/etsy-shop.js';

const OWNER = 'wait_owner';
let X = '';
let PRODUCT = '';
const read = () => bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });
const sense = async () => (await query(
  `SELECT last_error, read_not_before FROM company_senses WHERE product_id = ?`, [PRODUCT])).rows[0] as Record<string, unknown>;
const secondsUntil = (t: unknown) => (Date.parse(`${String(t).replace(' ', 'T')}Z`) - Date.now()) / 1000;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_wait', 'wait@example.com', 'Owner']);
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await query(`INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4545', datetime('now'), 'test')`, [encrypt(JSON.stringify({ keystring: 'k', sharedSecret: 's' }))]);
  const senseId = nanoid();
  await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_label)
     VALUES (?,?,'revenue','etsy','real','read-only, for this test','ApexMicro')`, [senseId, PRODUCT]);
  await query(`INSERT INTO sense_credentials (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
     VALUES (?,?,?,'etsy',?,?,?)`,
    [nanoid(), senseId, PRODUCT, JSON.stringify(['shops_r', 'listings_r', 'transactions_r']),
      encryptCredentialPayload(JSON.stringify({ access_token: 'tok', shop_id: '77770005' })),
      new Date(Date.now() + 3600_000).toISOString()]);
});

describe('Etsy says "not so often"', () => {
  it('is told as a request to wait, with when, and the silence is still not evidence', async () => {
    limited = true; retryAfter = '120';
    const r = await read();
    expect(r.read).toBe(false);
    expect(r.because).toMatch(/Etsy asked Foundry to wait/);
    expect(r.because).toMatch(/nothing is concluded/);
    const s = await sense();
    expect(s.last_error).not.toBeNull();
    expect(secondsUntil(s.read_not_before)).toBeGreaterThan(100);
    expect(secondsUntil(s.read_not_before)).toBeLessThan(140);
  });

  it('does not ask again before then', async () => {
    const before = calls;
    const r = await read();
    expect(calls).toBe(before);
    expect(r.read).toBe(false);
    expect(r.because).toMatch(/asked Foundry to wait until/);
  });

  it('waits a minute when Etsy gives no time, and never more than a day', async () => {
    await query(`UPDATE company_senses SET read_not_before = NULL WHERE product_id = ?`, [PRODUCT]);
    retryAfter = undefined;
    await read();
    const once = secondsUntil((await sense()).read_not_before);
    expect(once).toBeGreaterThan(40);
    expect(once).toBeLessThan(80);
    await query(`UPDATE company_senses SET read_not_before = NULL WHERE product_id = ?`, [PRODUCT]);
    retryAfter = String(30 * 86_400);
    await read();
    expect(secondsUntil((await sense()).read_not_before)).toBeLessThanOrEqual(86_400 + 5);
  });
});

describe('once the wait is over', () => {
  it('reads again, and a good read clears the wait and the error', async () => {
    await query(`UPDATE company_senses SET read_not_before = datetime('now','-1 minute') WHERE product_id = ?`, [PRODUCT]);
    limited = false;
    const r = await read();
    expect(r.read).toBe(true);
    const s = await sense();
    expect(s.last_error).toBeNull();
    expect(s.read_not_before).toBeNull();
  });
});
