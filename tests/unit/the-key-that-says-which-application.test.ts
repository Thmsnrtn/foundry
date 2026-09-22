// =============================================================================
// THE KEY THAT SAYS WHICH APPLICATION THIS IS.
//
// The owner supplied an Etsy application keystring and shared secret and asked
// that they be kept in the institution rather than set as a deployment secret,
// so that he can place one from a phone rather than from a machine carrying
// `flyctl` and a deploy token.
//
// An application key is neither of the two things this codebase already had a
// shelf for. It is not a deployment fact in an environment variable, and it is
// not a per-company grant: it identifies THIS DEPLOYMENT to a provider and
// gives access to nobody's account. Filing it under a company would say
// something false about what it is.
//
// VERIFIED BEFORE IT IS KEPT, which is the convention the sending identity
// established: `setSendingIdentity` will not store a Resend key until Resend
// confirms the domain, because "the owner typed something" and "the provider
// accepts it" are different facts. Etsy's `openapi-ping` takes a key, no OAuth
// token, costs nothing and causes nothing — so a mistyped pair is refused while
// he still has it in front of him.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'd'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Etsy's ping, played by a double. Its answer is the whole of the verification. */
let PING: { status: number; body: unknown } = { status: 200, body: { application_id: 4242 } };

vi.mock('../../src/services/outbound/ssrf.js', () => ({
  safeFetch: vi.fn(async () => ({
    ok: PING.status >= 200 && PING.status < 300,
    status: PING.status,
    json: async () => PING.body,
    text: async () => JSON.stringify(PING.body),
  })),
  assertUrlSafe: vi.fn(async (u: string) => new URL(u)),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  appCredentialFor, etsyAppKey, etsyApiKeyHeader, forgetAppCredential, setAppCredential,
} from '../../src/services/senses/app-credential.js';

// A SYNTHETIC PAIR, and the literal is synthetic too. This line used to hold
// the owner's real keystring with `.replace(/./g, 'x')` after it — masked at
// runtime, and fully present in the file and in git history. Masking a value
// you have already written down is not redaction; it only looks like care.
// Etsy keystrings are 24 characters, which is the only property any of these
// tests depends on.
const GOOD = { keystring: 'x'.repeat(24), sharedSecret: 'sssssssss' };

beforeAll(async () => { await runMigrations(); });
beforeEach(() => { PING = { status: 200, body: { application_id: 4242 } }; });
afterEach(async () => {
  await query(`UPDATE app_credentials SET forgotten_at = datetime('now'), forget_reason = 'scenario'
                WHERE forgotten_at IS NULL`);
});

describe('nothing is kept that the provider has not accepted', () => {
  it('refuses a pair Etsy rejects, and stores nothing', async () => {
    PING = { status: 401, body: {} };
    const r = await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    expect('failed' in r && r.ownerWords).toMatch(/does not accept that keystring/);
    expect(await appCredentialFor('etsy'), 'a refused key leaves nothing behind').toBeNull();
  });

  it('refuses when Etsy answers without saying which application it is', async () => {
    PING = { status: 200, body: {} };
    const r = await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    expect('failed' in r && r.ownerWords).toMatch(/did not say which application/);
    expect(await appCredentialFor('etsy')).toBeNull();
  });

  it('says so plainly when Etsy cannot be reached, rather than keeping it hopefully', async () => {
    PING = { status: 503, body: {} };
    const r = await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    expect('failed' in r && r.ownerWords).toMatch(/nothing has been stored/);
  });

  it('keeps it once Etsy names the application, and records which one', async () => {
    const r = await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    expect('placed' in r && r.providerAccountRef).toBe('4242');
    const held = await appCredentialFor('etsy');
    expect(held?.providerAccountRef).toBe('4242');
    // Not when he typed it. When the provider confirmed it.
    expect(held?.verifiedAt).toBeTruthy();
  });
});

describe('the likeliest slip is named rather than bounced by Etsy', () => {
  it('catches the joined pair pasted into the keystring box', async () => {
    // Etsy shows the two side by side and its own examples join them with a
    // colon, so pasting the joined form into one box is the mistake to expect.
    const r = await setAppCredential({
      provider: 'etsy', secret: { keystring: 'abc:def', sharedSecret: 'def' }, by: 'founder:t',
    });
    expect('failed' in r && r.ownerWords).toMatch(/has a colon in it/);
  });

  it('refuses a half-filled pair before asking Etsy anything', async () => {
    const r = await setAppCredential({
      provider: 'etsy', secret: { keystring: 'abc', sharedSecret: '  ' }, by: 'founder:t',
    });
    expect('failed' in r && r.ownerWords).toMatch(/both the keystring and the shared secret/);
  });
});

describe('what is on disk is not the key', () => {
  it('stores ciphertext, and the plaintext appears nowhere in the row', async () => {
    await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    const row = (await query(
      `SELECT secret_json FROM app_credentials WHERE provider = 'etsy'`))
      .rows[0] as Record<string, unknown>;
    const stored = String(row.secret_json);
    expect(stored).not.toContain(GOOD.keystring);
    expect(stored).not.toContain(GOOD.sharedSecret);
    // `iv:ciphertext:authTag`, all hex.
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('refuses a row written in plaintext, whoever writes it next', async () => {
    await expect(query(
      // check-vocabulary:expected-refusal
      `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
       VALUES ('someone', '{"keystring":"raw"}', '1', datetime('now'), 'test')`))
      .rejects.toThrow(/must_be_encrypted/);
  });

  it('cannot arrive unverified', async () => {
    await expect(query(
      // check-vocabulary:expected-refusal
      `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
       VALUES ('someone', 'aa:bb:cc', '', datetime('now'), 'test')`))
      .rejects.toThrow(/incomplete/);
  });
});

describe('the shape the adapter and the reader both want', () => {
  it('joins the halves for the header and keeps them apart in the row', async () => {
    await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    const key = await etsyAppKey();
    expect(key).not.toBeNull();
    // `x-api-key` wants them joined; `client_id` wants the keystring alone.
    // Storing them apart is what makes that distinction impossible to confuse.
    expect(etsyApiKeyHeader(key!)).toBe(`${GOOD.keystring}:${GOOD.sharedSecret}`);
    expect(key!.keystring).not.toContain(':');
  });

  it('answers null once it is forgotten, so nothing keeps using it', async () => {
    await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    await forgetAppCredential('etsy', 'the owner removed it');
    expect(await etsyAppKey()).toBeNull();
  });

  it('refuses to forget without saying why', async () => {
    await setAppCredential({ provider: 'etsy', secret: GOOD, by: 'founder:t' });
    await expect(query(
      // check-vocabulary:expected-refusal
      `UPDATE app_credentials SET forgotten_at = datetime('now') WHERE provider = 'etsy'`))
      .rejects.toThrow(/forget_needs_reason/);
  });
});
