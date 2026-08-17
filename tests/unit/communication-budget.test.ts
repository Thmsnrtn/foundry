// =============================================================================
// Tests: V3.1 Layer C — Communication Budget
// Under-cap pass, at-cap block, week boundary reset, custom cap.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import {
  checkAndIncrement,
  setCustomCap,
} from '../../src/services/outbound/budget.js';

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
      resolve(__dirname, '../../src/db/migrations/067_communication_budgets.sql'),
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
  await executeRaw(`DELETE FROM communication_budgets`);
});

// ─── Default cap (3) ──────────────────────────────────────────────────────────

describe('checkAndIncrement: default cap of 3', () => {
  it('allows the first three messages and blocks the fourth', async () => {
    const week = '2026-05-04';
    const customer = 'cust@example.com';

    const r1 = await checkAndIncrement(productId, customer, week);
    expect(r1.allowed).toBe(true);
    expect(r1.sent_count).toBe(1);
    expect(r1.remaining).toBe(2);

    const r2 = await checkAndIncrement(productId, customer, week);
    expect(r2.allowed).toBe(true);
    expect(r2.sent_count).toBe(2);

    const r3 = await checkAndIncrement(productId, customer, week);
    expect(r3.allowed).toBe(true);
    expect(r3.sent_count).toBe(3);
    expect(r3.remaining).toBe(0);

    const r4 = await checkAndIncrement(productId, customer, week);
    expect(r4.allowed).toBe(false);
    expect(r4.sent_count).toBe(3); // unchanged — block does NOT increment
    expect(r4.remaining).toBe(0);
  });

  it('does not increment sent_count when blocked', async () => {
    const week = '2026-05-04';
    const customer = 'cust@example.com';
    for (let i = 0; i < 3; i++) {
      await checkAndIncrement(productId, customer, week);
    }
    await checkAndIncrement(productId, customer, week); // blocked
    await checkAndIncrement(productId, customer, week); // blocked

    const row = await query(
      `SELECT sent_count FROM communication_budgets
        WHERE product_id = ? AND customer_external_id = ? AND week_starting = ?`,
      [productId, customer, week]
    );
    expect((row.rows[0] as Record<string, number>).sent_count).toBe(3);
  });
});

// ─── Week boundary ────────────────────────────────────────────────────────────

describe('checkAndIncrement: week boundary', () => {
  it('budget resets when week_starting changes', async () => {
    const customer = 'cust@example.com';
    const w1 = '2026-05-04';
    const w2 = '2026-05-11';

    for (let i = 0; i < 3; i++) {
      await checkAndIncrement(productId, customer, w1);
    }
    const blocked = await checkAndIncrement(productId, customer, w1);
    expect(blocked.allowed).toBe(false);

    // New week → fresh budget
    const r = await checkAndIncrement(productId, customer, w2);
    expect(r.allowed).toBe(true);
    expect(r.sent_count).toBe(1);
  });
});

// ─── Customer isolation ───────────────────────────────────────────────────────

describe('checkAndIncrement: customer isolation', () => {
  it('different customer keys have independent budgets', async () => {
    const week = '2026-05-04';

    for (let i = 0; i < 3; i++) {
      await checkAndIncrement(productId, 'a@example.com', week);
    }
    const blockedA = await checkAndIncrement(productId, 'a@example.com', week);
    expect(blockedA.allowed).toBe(false);

    const r = await checkAndIncrement(productId, 'b@example.com', week);
    expect(r.allowed).toBe(true);
    expect(r.sent_count).toBe(1);
  });
});

// ─── Custom cap ───────────────────────────────────────────────────────────────

describe('setCustomCap', () => {
  it('overrides the default cap for a (product, customer, week)', async () => {
    const week = '2026-05-04';
    const customer = 'high-touch@example.com';
    await setCustomCap(productId, customer, week, 5);

    for (let i = 0; i < 5; i++) {
      const r = await checkAndIncrement(productId, customer, week);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAndIncrement(productId, customer, week);
    expect(blocked.allowed).toBe(false);
    expect(blocked.cap).toBe(5);
  });

  it('lowers the cap on an existing row', async () => {
    const week = '2026-05-04';
    const customer = 'noisy@example.com';
    await checkAndIncrement(productId, customer, week);
    await checkAndIncrement(productId, customer, week);

    await setCustomCap(productId, customer, week, 1); // cap below current count

    const r = await checkAndIncrement(productId, customer, week);
    expect(r.allowed).toBe(false);
    expect(r.cap).toBe(1);
    expect(r.sent_count).toBe(2);
  });

  it('creates the row at sent_count=0 when none exists', async () => {
    const week = '2026-05-04';
    const customer = 'preset@example.com';
    await setCustomCap(productId, customer, week, 7);

    const row = await query(
      `SELECT sent_count, cap FROM communication_budgets
        WHERE product_id = ? AND customer_external_id = ? AND week_starting = ?`,
      [productId, customer, week]
    );
    const r = row.rows[0] as Record<string, number>;
    expect(r.sent_count).toBe(0);
    expect(r.cap).toBe(7);
  });
});
