// =============================================================================
// Tests: V3.1 Layer C — Data Classification Policy
// Default policy, explicit allow/forbid, missing surface, upsert overwrite.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import {
  getPolicy,
  upsertPolicy,
  checkAllowed,
} from '../../src/services/outbound/classification.js';

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
      scp_status TEXT DEFAULT 'active',
      entitlement_paused_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/066_data_classifications.sql'),
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
  await executeRaw(`DELETE FROM data_classifications`);
});

// ─── Default policy ───────────────────────────────────────────────────────────

describe('checkAllowed: default policy (no row exists)', () => {
  it("allows 'general' by default", async () => {
    const r = await checkAllowed(productId, 'email_outbound', 'general');
    expect(r.allowed).toBe(true);
  });

  it("allows 'customer' by default", async () => {
    const r = await checkAllowed(productId, 'email_outbound', 'customer');
    expect(r.allowed).toBe(true);
  });

  it("rejects 'pii_strict' by default", async () => {
    const r = await checkAllowed(productId, 'email_outbound', 'pii_strict');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/no policy/);
  });

  it("rejects 'financial_secret' by default", async () => {
    const r = await checkAllowed(productId, 'public_landing', 'financial_secret');
    expect(r.allowed).toBe(false);
  });
});

// ─── Explicit policy ──────────────────────────────────────────────────────────

describe('checkAllowed: explicit policy', () => {
  it('allows a class listed in allowed_classes', async () => {
    await upsertPolicy(productId, 'email_outbound', {
      allowed_classes: ['general', 'customer', 'pii_strict'],
    });
    const r = await checkAllowed(productId, 'email_outbound', 'pii_strict');
    expect(r.allowed).toBe(true);
  });

  it('forbidden_classes overrides allowed_classes', async () => {
    await upsertPolicy(productId, 'public_landing', {
      allowed_classes: ['general', 'customer'],
      forbidden_classes: ['customer'],
    });
    const r = await checkAllowed(productId, 'public_landing', 'customer');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/forbids/);
  });

  it("rejects a class that is neither allowed nor forbidden when policy exists", async () => {
    await upsertPolicy(productId, 'email_outbound', {
      allowed_classes: ['general'],
    });
    const r = await checkAllowed(productId, 'email_outbound', 'customer');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/does not list/);
  });

  it('different surface on same product is independent', async () => {
    await upsertPolicy(productId, 'email_outbound', {
      allowed_classes: ['general', 'customer', 'pii_strict'],
    });
    const r = await checkAllowed(productId, 'public_landing', 'pii_strict');
    expect(r.allowed).toBe(false); // public_landing has no policy → default
  });
});

// ─── upsertPolicy ─────────────────────────────────────────────────────────────

describe('upsertPolicy', () => {
  it('inserts a new policy when none exists', async () => {
    const policy = await upsertPolicy(productId, 'cs_thread', {
      allowed_classes: ['general', 'customer'],
      notes: 'support replies',
    });
    expect(policy.allowed_classes).toEqual(['general', 'customer']);
    expect(policy.notes).toBe('support replies');

    const fetched = await getPolicy(productId, 'cs_thread');
    expect(fetched?.id).toBe(policy.id);
  });

  it('overwrites an existing policy (single row per product+surface)', async () => {
    await upsertPolicy(productId, 'cs_thread', {
      allowed_classes: ['general'],
    });
    await upsertPolicy(productId, 'cs_thread', {
      allowed_classes: ['general', 'customer'],
      forbidden_classes: ['pii_strict'],
    });

    const policy = await getPolicy(productId, 'cs_thread');
    expect(policy?.allowed_classes).toEqual(['general', 'customer']);
    expect(policy?.forbidden_classes).toEqual(['pii_strict']);

    const all = await query(
      `SELECT COUNT(*) AS n FROM data_classifications WHERE product_id = ? AND surface = ?`,
      [productId, 'cs_thread']
    );
    expect(Number((all.rows[0] as Record<string, unknown>).n)).toBe(1);
  });
});

// ─── getPolicy ────────────────────────────────────────────────────────────────

describe('getPolicy', () => {
  it('returns null when no row exists', async () => {
    const p = await getPolicy(productId, 'never_set');
    expect(p).toBeNull();
  });
});
