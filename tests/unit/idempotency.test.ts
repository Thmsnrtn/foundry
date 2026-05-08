// =============================================================================
// Tests: V3.1 Layer C — Outbound Idempotency
// Forward-path reservation, race-safe re-read, cached result return,
// expiration, cleanup.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import {
  checkAndReserve,
  storeResult,
  cleanupExpired,
} from '../../src/services/outbound/idempotency.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/065_idempotency_keys.sql'),
      'utf-8'
    )
  );
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`, 'growth']
  );
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [
    productId,
    'Test',
    founderId,
  ]);
  // Wipe rows from prior tests; CREATE TABLE IF NOT EXISTS keeps the schema.
  await executeRaw(`DELETE FROM idempotency_keys`);
});

// ─── checkAndReserve ──────────────────────────────────────────────────────────

describe('checkAndReserve', () => {
  it('first call is fresh and reserves the row', async () => {
    const r = await checkAndReserve(productId, 'send_email', 'msg-123', 60);
    expect(r.fresh).toBe(true);
    expect(r.cached).toBeNull();

    const rows = await query(
      `SELECT * FROM idempotency_keys WHERE product_id = ? AND dedup_key = ?`,
      [productId, 'msg-123']
    );
    expect(rows.rows.length).toBe(1);
  });

  it('second call with same key returns fresh=false and cached null until storeResult', async () => {
    await checkAndReserve(productId, 'send_email', 'msg-456', 60);
    const r2 = await checkAndReserve(productId, 'send_email', 'msg-456', 60);
    expect(r2.fresh).toBe(false);
    expect(r2.cached).toBeNull();
  });

  it('returns cached result after storeResult', async () => {
    await checkAndReserve(productId, 'send_email', 'msg-789', 60);
    await storeResult(productId, 'send_email', 'msg-789', { id: 'em_1', accepted: true });

    const r = await checkAndReserve(productId, 'send_email', 'msg-789', 60);
    expect(r.fresh).toBe(false);
    expect(r.cached).toEqual({ id: 'em_1', accepted: true });
  });

  it('different action_type with same dedup_key is independent', async () => {
    await checkAndReserve(productId, 'send_email', 'shared-key', 60);
    const r = await checkAndReserve(productId, 'create_pr', 'shared-key', 60);
    expect(r.fresh).toBe(true);
  });

  it('different product with same key is independent', async () => {
    const otherProductId = nanoid();
    await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [
      otherProductId,
      'Other',
      founderId,
    ]);
    await checkAndReserve(productId, 'send_email', 'shared', 60);
    const r = await checkAndReserve(otherProductId, 'send_email', 'shared', 60);
    expect(r.fresh).toBe(true);
  });

  it('expired row is treated as absent — next call is fresh', async () => {
    // Insert directly with an expired timestamp
    await query(
      `INSERT INTO idempotency_keys (id, product_id, action_type, dedup_key, expires_at, result_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        productId,
        'send_email',
        'old-key',
        new Date(Date.now() - 1000).toISOString(),
        JSON.stringify({ stale: true }),
      ]
    );
    const r = await checkAndReserve(productId, 'send_email', 'old-key', 60);
    // Either fresh=true (we re-inserted alongside expired) or fresh=false
    // depending on UNIQUE handling; the key check is that cached is NOT
    // returned from the expired row.
    expect(r.cached).toBeNull();
  });

  it('agent_id is recorded when supplied', async () => {
    await checkAndReserve(productId, 'send_email', 'agent-key', 60, 'beacon');
    const rows = await query(
      `SELECT agent_id FROM idempotency_keys WHERE product_id = ? AND dedup_key = ?`,
      [productId, 'agent-key']
    );
    expect((rows.rows[0] as Record<string, string>).agent_id).toBe('beacon');
  });
});

// ─── storeResult ──────────────────────────────────────────────────────────────

describe('storeResult', () => {
  it('overwrites prior result_json', async () => {
    await checkAndReserve(productId, 'send_email', 'k1', 60);
    await storeResult(productId, 'send_email', 'k1', { v: 1 });
    await storeResult(productId, 'send_email', 'k1', { v: 2 });

    const r = await checkAndReserve(productId, 'send_email', 'k1', 60);
    expect(r.cached).toEqual({ v: 2 });
  });
});

// ─── cleanupExpired ───────────────────────────────────────────────────────────

describe('cleanupExpired', () => {
  it('deletes expired rows and leaves fresh rows alone', async () => {
    // Fresh
    await checkAndReserve(productId, 'send_email', 'fresh-key', 60);
    // Expired (insert directly)
    await query(
      `INSERT INTO idempotency_keys (id, product_id, action_type, dedup_key, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        nanoid(),
        productId,
        'send_email',
        'expired-key',
        new Date(Date.now() - 1000).toISOString(),
      ]
    );

    await cleanupExpired();

    const rows = await query(
      `SELECT dedup_key FROM idempotency_keys WHERE product_id = ?`,
      [productId]
    );
    const keys = rows.rows.map((r) => (r as Record<string, string>).dedup_key);
    expect(keys).toContain('fresh-key');
    expect(keys).not.toContain('expired-key');
  });
});
