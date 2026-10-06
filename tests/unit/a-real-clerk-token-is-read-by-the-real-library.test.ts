// =============================================================================
// A REAL CLERK TOKEN IS READ BY THE REAL LIBRARY (remediation audit, 6 October 2026).
//
// The adapter `verifiedClerkClaims` was written against a double of
// `@clerk/backend` 3 that returned `{ data } / { errors }` — the shape of the
// package's INNER function. The function it exports throws and returns the
// payload, so the adapter read `.data` off a payload, found nothing, and
// refused every valid token: the owner, locked out, by a change whose test was
// green. Nothing in this file is mocked but the network: an RS256 token is
// signed here, Clerk's key endpoint answers with its public key, and the real
// package verifies it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'ins_test_kid';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const b64 = (v: unknown): string => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function sign(claims: Record<string, unknown>, key = privateKey): string {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
  const body = b64(claims);
  const s = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${s}`;
}
const now = (): number => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sub: 'user_owner', sid: 'sess_owner', iss: 'https://owner.clerk.accounts.dev',
  iat: now() - 10, nbf: now() - 10, exp: now() + 50, ...over,
});

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (/\/jwks$/.test(new URL(u).pathname)) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('not found', { status: 404 });
  }));
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('verifiedClerkClaims against the installed @clerk/backend', () => {
  it('a valid token yields its subject (the case the first adapter refused)', async () => {
    const { verifiedClerkClaims } = await import('../../src/middleware/auth.js');
    const c = await verifiedClerkClaims(sign(claims()), 'sk_test_real_lib');
    expect(c.sub).toBe('user_owner');
    expect(c.sid).toBe('sess_owner');
  });

  it('an expired token is refused', async () => {
    const { verifiedClerkClaims } = await import('../../src/middleware/auth.js');
    await expect(verifiedClerkClaims(sign(claims({ exp: now() - 600 })), 'sk_test_real_lib')).rejects.toThrow();
  });

  it('a token signed with another key is refused', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const { verifiedClerkClaims } = await import('../../src/middleware/auth.js');
    await expect(verifiedClerkClaims(sign(claims(), other), 'sk_test_real_lib')).rejects.toThrow();
  });

  it('a validly signed token from an issuer that is not Clerk is refused', async () => {
    const { verifiedClerkClaims } = await import('../../src/middleware/auth.js');
    await expect(verifiedClerkClaims(sign(claims({ iss: 'https://elsewhere.example' })), 'sk_test_real_lib')).rejects.toThrow(/not issued by Clerk/);
  });
});
