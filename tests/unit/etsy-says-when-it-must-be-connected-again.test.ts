// =============================================================================
// ETSY SAYS WHEN IT MUST BE CONNECTED AGAIN, BEFORE IT HAPPENS.
//
// An Etsy access token lasts an hour and is renewed every hour
// (`sense_credential_tick`). What renews it is the refresh token, and Etsy
// gives that ninety days. If Etsy issues a fresh one on each renewal, the
// connection lives for as long as it is used. If it does not, the connection
// dies on a date fixed at the moment he connected, and the first sign was
// going to be a failed renewal and a shop gone dark.
//
// Nothing here assumes which of the two Etsy does. The date is recorded when
// the permission is granted, moved only when Etsy actually hands back a
// DIFFERENT refresh token, and kept when it hands back the same one or none.
// Two weeks before it ends, the Brief says so, with the date and what to do.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'rc@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

/** Etsy's token endpoint, played by a double that may or may not rotate. */
let hands: 'new' | 'same' | 'none' = 'new';
let issued = 0;
vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = new URLSearchParams(String(init?.body ?? ''));
    issued += 1;
    const refresh = hands === 'new' ? `rt-${String(issued)}` : hands === 'same' ? sent.get('refresh_token') : undefined;
    const body: Record<string, unknown> = { access_token: `at-${String(issued)}`, expires_in: 3600 };
    if (refresh) body.refresh_token = refresh;
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  }),
  assertUrlSafe: vi.fn(async (u: string) => new URL(u)),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encrypt, encryptCredentialPayload } from '../../src/services/encryption.js';
import { renewCredentials } from '../../src/services/senses/credentials.js';
import { senseProvider } from '../../src/services/senses/providers/contract.js';

const OWNER = 'rc_owner';
const P = 'rc_co';
let CRED = '';
const DAY = 86_400_000;

const refreshEndsAt = async (): Promise<string | null> => {
  const r = (await query('SELECT refresh_expires_at FROM sense_credentials WHERE id = ?', [CRED])).rows[0] as Record<string, unknown>;
  return r.refresh_expires_at == null ? null : String(r.refresh_expires_at);
};
const setRefreshEnd = (iso: string | null) =>
  query('UPDATE sense_credentials SET refresh_expires_at = ?, expires_at = ? WHERE id = ?',
    [iso, new Date(Date.now() + 30 * 60_000).toISOString(), CRED]);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_rc', 'rc@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')`, [P, OWNER]);
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
     VALUES ('etsy', ?, '4545', datetime('now'), 'test')`,
    [encrypt(JSON.stringify({ keystring: 'test-keystring', sharedSecret: 'test-secret' }))]);
  const senseId = nanoid();
  await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_label)
     VALUES (?,?,'revenue','etsy','real','read-only, for this test','ApexMicro')`, [senseId, P]);
  CRED = nanoid();
  await query(
    `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider, granted_scopes_json, secret_json, expires_at)
     VALUES (?,?,?,'etsy',?,?,?)`,
    [CRED, senseId, P, JSON.stringify(['shops_r', 'listings_r', 'transactions_r']),
      encryptCredentialPayload(JSON.stringify({ access_token: 'at-0', refresh_token: 'rt-0', shop_id: '1' })),
      new Date(Date.now() + 30 * 60_000).toISOString()]);
});

describe('what the Etsy adapter says about the refresh token', () => {
  it('a different refresh token handed back starts a fresh ninety days', async () => {
    hands = 'new';
    const adapter = (await senseProvider('etsy'))!;
    const r = await adapter.refresh({ refresh_token: 'rt-old' }, { keystring: 'k', sharedSecret: 's' });
    const days = (r!.refreshExpiresAt!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('the same one, or none, moves nothing — the old date stands', async () => {
    const adapter = (await senseProvider('etsy'))!;
    hands = 'same';
    expect((await adapter.refresh({ refresh_token: 'rt-old' }, { keystring: 'k', sharedSecret: 's' }))!.refreshExpiresAt).toBeUndefined();
    hands = 'none';
    expect((await adapter.refresh({ refresh_token: 'rt-old' }, { keystring: 'k', sharedSecret: 's' }))!.refreshExpiresAt).toBeUndefined();
  });
});

describe('the renewal keeps the date honestly', () => {
  it('records a fresh end when Etsy rotates the refresh token', async () => {
    hands = 'new';
    await setRefreshEnd(null);
    const out = await renewCredentials();
    expect(out.renewed).toBe(1);
    const end = await refreshEndsAt();
    expect(end).not.toBeNull();
    expect((new Date(end!).getTime() - Date.now()) / DAY).toBeGreaterThan(89.9);
  });

  it('keeps the end it had when Etsy does not rotate it', async () => {
    const fixed = new Date(Date.now() + 40 * DAY).toISOString();
    await setRefreshEnd(fixed);
    hands = 'same';
    await renewCredentials();
    expect(await refreshEndsAt()).toBe(fixed);
    hands = 'none';
    await setRefreshEnd(fixed);
    await renewCredentials();
    expect(await refreshEndsAt()).toBe(fixed);
  });
});

describe('the Brief says it two weeks ahead', () => {
  const brief = async () => {
    const { healthOf } = await import('../../src/services/founder/health.js');
    return (await healthOf(OWNER)).didNotDoTheDay.join('\n');
  };

  it('says nothing while it is further off than that', async () => {
    await setRefreshEnd(new Date(Date.now() + 30 * DAY).toISOString());
    expect(await brief()).not.toMatch(/permission to read/);
  });

  it('names the date and what to do when it is close', async () => {
    const end = new Date(Date.now() + 10 * DAY).toISOString();
    await setRefreshEnd(end);
    const said = await brief();
    expect(said).toMatch(new RegExp(`Etsy's permission to read ApexMicro ends on ${end.slice(0, 10)}`));
    expect(said).toMatch(/connect it again before then/);
  });

  it('says nothing for a connection he has already ended', async () => {
    await query(`UPDATE sense_credentials SET revoked_at = datetime('now'), revoke_reason = 'he ended it' WHERE id = ?`, [CRED]);
    expect(await brief()).not.toMatch(/permission to read/);
  });
});
