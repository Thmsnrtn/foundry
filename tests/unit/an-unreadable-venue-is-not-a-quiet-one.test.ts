// =============================================================================
// AN UNREADABLE VENUE IS NOT A QUIET ONE.
//
// Integrated plan §9 asks for three degraded conditions to be rehearsed. This
// is the first: Etsy becomes unreadable. A token that starts answering 401, a
// rate limit, an outage, a dropped connection.
//
// What the code did: every one of those threw out of the reader, past the one
// place that writes a sense's `last_error`, and into a job loop that logged a
// warning and moved on. So nothing recorded that the shop had gone dark.
// Readiness kept saying the venue "can be read" on the strength of old
// readings. The absence reading, which only looks at earned companies, could
// not see a listing asset at all. And a listing test whose window closed while
// Etsy was unreadable settled "Not as predicted" — a no-sale conclusion drawn
// through a gap, which is the one conclusion this institution exists to refuse.
//
// What has to hold while Etsy is unreadable, and after it recovers:
//   · the failure is recorded against the connection, in words;
//   · readiness stops calling the venue readable;
//   · a silent window does not settle; it waits for a read;
//   · the asset's record says who must look at Etsy in the meantime;
//   · the absence reading counts it as something quiet for a reason that is
//     not calm;
//   · and when Etsy answers again, all of that clears on its own.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'uv@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

/** Etsy's part, played by a double that can be made to fail. */
let mode: 'ok' | '503' | 'network' = 'ok';
const ETSY: Record<string, unknown> = {
  'users/me': { user_id: 42, shop_id: 77770001 },
  'shops/77770001': { shop_id: 77770001, shop_name: 'ApexMicro', url: 'https://www.etsy.com/shop/ApexMicro' },
  'shops/77770001/listings': { count: 0, results: [] },
  'shops/77770001/receipts': { count: 0, results: [] },
};

vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async (url: string) => {
    if (mode === 'network') throw new Error('connect ETIMEDOUT');
    if (mode === '503') return { ok: false, status: 503, json: async () => ({}) };
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
import { approveListing, PROOF2_WINDOW_DAYS, recordListing, seedProof2, settleListings } from '../../src/services/venture/proof-2.js';
import { bringTheVenueUpToDate } from '../../src/services/senses/readers/etsy-shop.js';
import { qualificationOf } from '../../src/services/venture/qualification.js';
import { operatingContractOf } from '../../src/services/venture/operating-contract.js';
import { absenceReading } from '../../src/services/institution/absence-test.js';

const OWNER = 'uv_owner';
let X = '';
let PRODUCT = '';

const lastError = async (): Promise<string | null> => {
  const r = (await query(
    `SELECT last_error FROM company_senses WHERE product_id = ? AND provider = 'etsy' AND disconnected_at IS NULL`,
    [PRODUCT])).rows[0] as Record<string, unknown> | undefined;
  return r?.last_error == null ? null : String(r.last_error);
};
const readable = async () => (await qualificationOf(X)).conditions
  .find((c) => c.name === 'what the venue reports can be read')!;
const read = () => bringTheVenueUpToDate({ founderId: OWNER, experimentId: X });

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_uv', 'uv@example.com', 'Owner']);
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  PRODUCT = String(((await query(
    'SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4242', datetime('now'), 'test')`,
    [encrypt(JSON.stringify({ keystring: 'test-keystring', sharedSecret: 'test-secret' }))]);
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
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776655/workbook' });
  // A grade in the same second as the prediction is refused as ambiguous.
  await new Promise((r) => setTimeout(r, 1100));
});

describe('while Etsy answers, it is read', () => {
  it('reads, records no error, and readiness calls the venue readable', async () => {
    mode = 'ok';
    const r = await read();
    expect(r.read).toBe(true);
    expect(await lastError()).toBeNull();
    expect((await readable()).verdict).toBe('met');
  });
});

describe('when Etsy stops answering', () => {
  it('records a 503 against the connection instead of throwing it away', async () => {
    mode = '503';
    const r = await read();
    expect(r.read).toBe(false);
    expect(await lastError()).toMatch(/503/);
  });

  it('records a dropped connection the same way', async () => {
    mode = 'network';
    const r = await read();
    expect(r.read).toBe(false);
    expect(await lastError()).toMatch(/ETIMEDOUT/);
  });

  it('stops calling the venue readable, on the strength of old readings', async () => {
    const c = await readable();
    expect(c.verdict).not.toBe('met');
    expect(c.because).toMatch(/last read of Etsy failed/);
  });

  it('tells him who has to look at Etsy in the meantime', async () => {
    const q3 = (await operatingContractOf(PRODUCT, OWNER))!.answers[2];
    expect(q3.answer).toMatch(/last read of Etsy failed/);
    expect(q3.answer).toMatch(/check orders and messages on Etsy yourself/);
    expect(q3.known).not.toBe('known');
  });

  it('counts it in the absence reading as quiet for a reason that is not calm', async () => {
    const truthful = (await absenceReading(OWNER, 14)).properties.find((p) => p.property === 'truthful')!;
    expect(truthful.finding).toBe('DOES_NOT_HOLD');
    expect(truthful.evidence.join('\n')).toMatch(/Etsy could not be read/);
  });

  it('does not let Home call the estate healthy — the first screen names it and who must look', async () => {
    const { healthOf } = await import('../../src/services/founder/health.js');
    const h = await healthOf(OWNER);
    expect(h.state).toBe('degraded');
    expect(h.word).toMatch(/1 thing needs looking at/);
    expect(h.didNotDoTheDay[0]).toMatch(/Etsy could not be read since \d{4}-\d{2}-\d{2}/);
    expect(h.didNotDoTheDay[0]).toMatch(/check its orders and messages on Etsy yourself/);
    expect(h.lastHealthy).toBeNull();
    const { Hono } = await import('hono');
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'uv@example.com' } as never); await next(); });
    app.route('/', foundryShellRoutes);
    const text = (await (await app.request('https://f.test/foundry')).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).not.toMatch(/Health Healthy/);
    expect(text).toMatch(/Etsy could not be read since/);
  });

  it('does not settle a silent window while Etsy cannot be read', async () => {
    await query(`UPDATE experiment_exposures SET placed_at = datetime('now', ?) WHERE experiment_id = ?`,
      [`-${String(PROOF2_WINDOW_DAYS + 1)} days`, X]);
    const [r] = await settleListings({ founderId: OWNER, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.settled).toBeNull();
    expect(r.because).toMatch(/could not be read/);
    const e = (await query('SELECT ran_at, verdict, validity FROM venture_experiments WHERE id = ?', [X]))
      .rows[0] as Record<string, unknown>;
    expect(e.ran_at).toBeNull();
    expect(e.verdict).toBeNull();
    expect(e.validity).toBe('valid');
  });
});

describe('when Etsy answers again, it all clears on its own', () => {
  it('clears the error, readiness, the record and the absence line, and then settles', async () => {
    mode = 'ok';
    expect((await read()).read).toBe(true);
    expect(await lastError()).toBeNull();
    expect((await readable()).verdict).toBe('met');
    expect((await operatingContractOf(PRODUCT, OWNER))!.answers[2].answer).not.toMatch(/failed/);
    const truthful = (await absenceReading(OWNER, 14)).properties.find((p) => p.property === 'truthful')!;
    expect(truthful.evidence.join('\n')).not.toMatch(/Etsy could not be read/);
    const { healthOf } = await import('../../src/services/founder/health.js');
    expect((await healthOf(OWNER)).didNotDoTheDay.join('\n')).not.toMatch(/Etsy could not be read/);
    // Etsy read the window and saw nobody buy: now the silence is evidence.
    const [r] = await settleListings({ founderId: OWNER, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.settled).toBe('surprised');
  });
});
