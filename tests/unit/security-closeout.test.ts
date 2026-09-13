// =============================================================================
// Tests: Security close-out (Finish-Line Directive step 3, 2026-07-13)
// P1: API-key authentication actually authenticates — the raw key is hashed and
//     compared against the stored hash, and the stored hash is not itself a key.
// External surface: ingest refuses poison (Infinity, out-of-range, oversize).
//
// TWO OF THE ORIGINAL SURFACES ARE GONE. The transcript webhook and the
// voice-reply webhook were Commercial Foundry routes and have been removed, and
// their payload bounds — the oversize-transcript 413, the audio size and mime
// checks — lived in those handlers, so they went with them. So did the investor
// share page, which is the only thing that ever wrote `investors.access_token`;
// nothing live reads or writes that table now, so there is no code left for the
// hashed-at-rest assertion to constrain.
//
// What the transcript webhook was really the witness for is not gone. It was
// the first caller of `validateApiKey`, and the defect it was written for was
// in the authentication itself: the old code compared the RAW key against the
// STORED HASH, so every legitimate key was refused and the value an attacker
// could read out of the database was the one that would have worked. That is a
// property of `issueApiKey` and `validateApiKey`, not of any route, and it is
// asserted against them directly below.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';
import { validateApiKey } from '../../src/services/rbac/permissions.js';

let app: Hono;
let rawApiKey: string;

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('sc_f','clk_sc','sc@t.co')", []);
  await query(
    "INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES ('sc_p','SecCo','sc_f','active','ingtok_secco_12345')", [],
  );
  // MINTED THROUGH THE DOOR THE PRODUCT USES, with a scope the routes enforce.
  // This used to call `rbac/permissions.ts`'s own `createApiKey` with the scope
  // `'transcripts'` — a string in no closed set, demanded by no route, and
  // therefore never checked by anything. It "worked" because the transcript
  // webhook checked no scope at all, which is the defect this fixture was
  // quietly resting on.
  const issued = await issueApiKey({
    productId: 'sc_p', founderId: 'sc_f', label: 'test', scopes: ['agents:write'],
  });
  if ('refused' in issued) throw new Error(`key not issued: ${issued.refused}`);
  rawApiKey = issued.key;

  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  app = new Hono();
  app.route('/', ingestRoutes);
});

describe('P1: API-key authentication authenticates for real', () => {
  it('a legitimate RAW key resolves (the old code compared raw vs stored hash → always null)', async () => {
    const resolved = await validateApiKey(rawApiKey);
    expect(resolved).not.toBeNull();
    expect(resolved?.productId).toBe('sc_p');
    expect(resolved?.userId, 'and the key acts as the person who issued it').toBe('sc_f');
    expect(resolved?.scopes).toContain('agents:write');
  });

  it('the raw key is never what is stored', async () => {
    const row = (await query("SELECT key_hash FROM api_keys WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, string>;
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.key_hash).not.toBe(rawApiKey);
  });

  it('a wrong key — including the stored hash itself — is refused', async () => {
    // The stored hash is the value an attacker reads out of the database. If
    // comparison happened on the wrong side it would be the one that worked.
    const hashRow = (await query("SELECT key_hash FROM api_keys WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, string>;
    for (const bad of ['fnd_totally_wrong_key', hashRow.key_hash, '']) {
      expect(await validateApiKey(bad), bad).toBeNull();
    }
  });

  it('a revoked key stops resolving', async () => {
    const issued = await issueApiKey({
      productId: 'sc_p', founderId: 'sc_f', label: 'to revoke', scopes: ['metrics:write'],
    });
    if ('refused' in issued) throw new Error(`key not issued: ${issued.refused}`);
    expect(await validateApiKey(issued.key)).not.toBeNull();

    await query("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?", [issued.id]);
    expect(await validateApiKey(issued.key)).toBeNull();
  });

  it('an expired key stops resolving', async () => {
    const issued = await issueApiKey({
      productId: 'sc_p', founderId: 'sc_f', label: 'to expire', scopes: ['metrics:write'],
    });
    if ('refused' in issued) throw new Error(`key not issued: ${issued.refused}`);

    await query("UPDATE api_keys SET expires_at = datetime('now', '-1 day') WHERE id = ?", [issued.id]);
    expect(await validateApiKey(issued.key)).toBeNull();
  });
});

describe('public ingest refuses poison', () => {
  const T = '/ingest/ingtok_secco_12345';

  it('accepts a sane payload', async () => {
    const res = await json(T, { mrr: 1200, churn_rate: 0.04, signups_7d: 12, nps: 40 });
    expect(res.status).toBe(200);
    const snap = (await query("SELECT churn_rate, mrr_cents FROM metric_snapshots WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, number>;
    expect(Number(snap.churn_rate)).toBe(0.04);
    // `mrr` means the level and lands in `mrr_cents`. It used to land in
    // `new_mrr_cents`, which means new business won this period — see
    // `mrr-the-level-and-mrr-the-movement.test.ts`. What this test is for is
    // unchanged: a sane payload is accepted and stored as sent.
    expect(Number(snap.mrr_cents)).toBe(120000);
  });

  it('refuses Infinity, out-of-range rates, negative counts, absurd NPS', async () => {
    for (const bad of [
      { mrr: '1e999' },          // parseFloat → Infinity; used to be stored
      { churn_rate: 5 },         // 500% churn
      { signups_7d: -3 },        // negative count
      { nps: 900 },              // NPS is [-100, 100]
    ]) {
      const res = await json(T, bad);
      expect(res.status).toBe(422);
    }
    // Nothing poisonous landed:
    const snap = (await query("SELECT churn_rate FROM metric_snapshots WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, number>;
    expect(Number(snap.churn_rate)).toBe(0.04); // still the sane value
  });

  it('bounds the custom-metrics junk drawer', async () => {
    const res = await json(T, { custom: { blob: 'x'.repeat(9000) } });
    expect(res.status).toBe(422);
  });
});
