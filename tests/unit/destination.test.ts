// =============================================================================
// Tests: V3.1 Layer A — Destination (North Star)
// Verifies north-star CRUD and gap computation. The outcome-tree and
// briefing-context cases went with their modules in Roadmap 2027 R4.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

import {
  upsertNorthStar,
  getNorthStar,
  computeGap,
  markReviewed,
  deleteNorthStar,
} from '../../src/services/destination/north-star.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

let founderId: string;
let productId: string;

async function createFounderAndProduct(): Promise<{ founderId: string; productId: string }> {
  const fId = nanoid();
  const pId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier)
     VALUES (?, ?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'Test Founder', 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [pId, 'Test Product', fId]
  );
  return { founderId: fId, productId: pId };
}

// Apply the minimal schema this test needs directly, instead of running the
// full migration chain. The full chain currently has a benign-but-blocking
// pre-existing issue at migration 007 (index on a missing column) that
// affects in-memory sqlite but not production Turso.
async function setupSchema(): Promise<void> {
  const TEST_SCHEMA = `
  `;
  await executeRaw(TEST_SCHEMA);
  // Apply migration 060 directly
  const migrationPath = resolve(__dirname, '../../src/db/migrations/060_north_stars_outcome_trees.sql');
  const sql = readFileSync(migrationPath, 'utf-8');
  await executeRaw(sql);
}

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
  await setupSchema();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
});

// ─── North Star: CRUD ─────────────────────────────────────────────────────────

describe('north_stars: CRUD', () => {
  it('returns null when no north star is set', async () => {
    const ns = await getNorthStar(productId);
    expect(ns).toBeNull();
  });

  it('upsert inserts when row absent', async () => {
    const ns = await upsertNorthStar(productId, {
      arr_target_dollars: 600_000,
      paying_accounts_target: 50,
      nrr_floor_pct: 110,
      target_date: '2027-05-07',
      destination_summary: 'Hit $50K MRR with 50 paying accounts at 110% NRR.',
    });
    expect(ns.arr_target_dollars).toBe(600_000);
    expect(ns.paying_accounts_target).toBe(50);
    expect(ns.target_date).toBe('2027-05-07');
  });

  it('upsert updates only fields explicitly provided', async () => {
    await upsertNorthStar(productId, {
      arr_target_dollars: 600_000,
      paying_accounts_target: 50,
      destination_summary: 'first summary',
    });
    await upsertNorthStar(productId, {
      destination_summary: 'second summary',
    });
    const ns = await getNorthStar(productId);
    expect(ns?.destination_summary).toBe('second summary');
    // Untouched fields preserved
    expect(ns?.arr_target_dollars).toBe(600_000);
    expect(ns?.paying_accounts_target).toBe(50);
  });

  it('upsert with explicit null clears that field', async () => {
    await upsertNorthStar(productId, {
      arr_target_dollars: 600_000,
      paying_accounts_target: 50,
    });
    await upsertNorthStar(productId, {
      arr_target_dollars: null,
    });
    const ns = await getNorthStar(productId);
    expect(ns?.arr_target_dollars).toBeNull();
    expect(ns?.paying_accounts_target).toBe(50);
  });

  it('markReviewed sets last_reviewed_at', async () => {
    await upsertNorthStar(productId, { arr_target_dollars: 100_000 });
    await markReviewed(productId);
    const ns = await getNorthStar(productId);
    expect(ns?.last_reviewed_at).toBeTruthy();
  });

  it('deleteNorthStar removes the row', async () => {
    await upsertNorthStar(productId, { arr_target_dollars: 100_000 });
    await deleteNorthStar(productId);
    expect(await getNorthStar(productId)).toBeNull();
  });
});

// ─── Gap Computation ──────────────────────────────────────────────────────────

describe('north-star: computeGap', () => {
  it('returns null when no north star', async () => {
    const gap = await computeGap(productId);
    expect(gap).toBeNull();
  });

  it('computes ARR progress percent against target from customers.mrr_cents', async () => {
    await upsertNorthStar(productId, {
      arr_target_dollars: 1_000_000,
      paying_accounts_target: 50,
      target_date: '2027-05-07',
    });
    // Seed two paying customers totalling $5K MRR → $60K ARR.
    for (let i = 0; i < 2; i++) {
      await query(
        `INSERT INTO customers (id, product_id, owner_id, mrr_cents) VALUES (?, ?, ?, ?)`,
        [nanoid(), productId, founderId, 250_000] // $2,500/mo each
      );
    }
    const gap = await computeGap(productId);
    expect(gap).not.toBeNull();
    expect(gap!.arr_target_dollars).toBe(1_000_000);
    // $5K MRR × 12 = $60K ARR; $60K / $1M = 6%
    expect(Math.round(gap!.arr_current_dollars ?? 0)).toBe(60_000);
    expect(Math.round(gap!.arr_progress_pct ?? 0)).toBe(6);
    expect(gap!.paying_accounts_current).toBe(2);
  });

  it('treats customers with mrr_cents=0 as non-paying', async () => {
    await upsertNorthStar(productId, { paying_accounts_target: 10 });
    await query(
      `INSERT INTO customers (id, product_id, owner_id, mrr_cents) VALUES (?, ?, ?, ?)`,
      [nanoid(), productId, founderId, 0]
    );
    await query(
      `INSERT INTO customers (id, product_id, owner_id, mrr_cents) VALUES (?, ?, ?, ?)`,
      [nanoid(), productId, founderId, 100_000]
    );
    const gap = await computeGap(productId);
    expect(gap!.paying_accounts_current).toBe(1);
  });
});
