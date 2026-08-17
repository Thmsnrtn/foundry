process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';

// =============================================================================
// TENANCY ↔ PUBLIC API: the limit was bound to the wrong thing.
//
// `/api/*` carries an IP-keyed flood guard. That is the right shape for an
// unauthenticated request and the wrong shape once one carries a credential:
//
//   • a single API key rotating source addresses was effectively unlimited;
//   • many customers behind one NAT shared a single 120/min budget.
//
// The AI and audit limits have always keyed by founder. The public API — the
// surface the owner has just made live — keyed by IP, and the MCP transport
// under it reaches tools that call a model, so those were 600 model calls an
// hour per key guarded only by the GLOBAL AI spend ceiling. A global ceiling is
// a blunt instrument: it stops everyone at once when one caller is expensive.
//
// The limit that matters on an authenticated surface is per credential, and it
// belongs after authentication — which is where the tenant is known.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const P = 'pat_co';
const OTHER = 'pat_other';
const OWNER = 'pat_owner';

let app: Hono;
let keyA: string;
let keyB: string;

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(
    `INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?),(?,?,?)`,
    [OWNER, 'pat_c1', 'o@example.com', 'pat_owner2', 'pat_c2', 'x@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?),(?,?,?,?)',
    [P, 'Co A', OWNER, 'active', OTHER, 'Co B', 'pat_owner2', 'active']);

  keyA = (await issueApiKey({
    productId: P, founderId: OWNER, label: 'A', scopes: ['agents:read'] }) as { key: string }).key;
  keyB = (await issueApiKey({
    productId: OTHER, founderId: 'pat_owner2', label: 'B', scopes: ['agents:read'] }) as { key: string }).key;

  const { apiV1 } = await import('../../src/api/v1/index.js');
  app = new Hono();
  app.route('/api/v1', apiV1 as unknown as Hono);
});

const call = (key: string, path = '/api/v1/agents') =>
  app.request(path, { headers: { Authorization: `Bearer ${key}` } });

describe('the public API limits by credential, not by address', () => {
  it('binds the limit to the tenant the credential established', () => {
    // Structural: the key function must read server-resolved context, never a
    // request header. A limit keyed by anything the caller controls is a limit
    // the caller can reset.
    const source = readFileSync(resolve(ROOT, 'src/middleware/rate-limit.ts'), 'utf8');
    const fn = source.slice(source.indexOf('export const apiKeyRateLimit'));
    const body = fn.slice(0, fn.indexOf('});'));
    expect(body).toContain("c.get('productId'");
    expect(body, 'the credential limit must not fall back to an address')
      .not.toMatch(/x-forwarded-for|cf-connecting-ip/);
  });

  it('runs after authentication, where the tenant is known', () => {
    // Ordering is the whole mechanism: applied in the composition root it would
    // run before `apiKeyAuth` and see no tenant at all.
    const source = readFileSync(resolve(ROOT, 'src/api/v1/index.ts'), 'utf8');
    expect(source.indexOf('apiKeyAuth)')).toBeLessThan(source.indexOf('apiKeyRateLimit)'));
    expect(source, 'the IP-keyed flood guard stays where it is')
      .not.toContain('publicRateLimit');
  });

  it('gives the model-backed transport a tighter budget than the rest', () => {
    const source = readFileSync(resolve(ROOT, 'src/api/v1/index.ts'), 'utf8');
    expect(source).toContain('apiModelRateLimit');
    const limits = readFileSync(resolve(ROOT, 'src/middleware/rate-limit.ts'), 'utf8');
    const model = /apiModelRateLimit = rateLimit\((\d+),/.exec(limits);
    const ordinary = /apiKeyRateLimit = rateLimit\((\d+),/.exec(limits);
    expect(Number(model![1]),
      'a call that spends money must not share the ordinary allowance')
      .toBeLessThan(Number(ordinary![1]));
  });

  it('does not let one company\'s traffic consume another\'s allowance', async () => {
    // Both keys are valid and belong to different tenants. Whatever the
    // allowance is, exhausting it for one must leave the other answering.
    const first = await call(keyA);
    expect([200, 403]).toContain(first.status);

    // Drive company A hard enough to be limited if the bucket were shared.
    for (let i = 0; i < 40; i += 1) await call(keyA);

    const other = await call(keyB);
    expect(other.status, 'company B must still be served').not.toBe(429);
  });

  it('refuses an unknown key before any allowance is spent', async () => {
    const res = await call('fnd_not_a_real_key_at_all_padding_padding');
    expect(res.status).toBe(401);
  });
});
