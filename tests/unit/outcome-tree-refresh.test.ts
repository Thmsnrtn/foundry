// =============================================================================
// Tests: V3.1 Layer A revisit — Outcome Tree Health Refresh
// Verifies metric→branch propagation, stale supersede, count reporting,
// and that branches with non-whitelisted metric_keys are left alone.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import {
  addBranch,
  getBranch,
} from '../../src/services/destination/outcome-tree.js';
import { refreshOutcomeTreeHealth } from '../../src/services/destination/outcome-tree-refresh.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/060_north_stars_outcome_trees.sql'),
      'utf-8'
    )
  );
}

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
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
  // Reset cross-test state
  await executeRaw(`DELETE FROM outcome_trees`);
  await executeRaw(`DELETE FROM metric_snapshots`);
});

async function insertSnapshot(values: Partial<Record<string, number>> & { snapshot_date: string }) {
  const cols = ['id', 'product_id', 'snapshot_date'];
  const vals: unknown[] = [nanoid(), productId, values.snapshot_date];
  for (const k of ['signups_7d', 'active_users', 'new_mrr_cents', 'churn_rate', 'activation_rate']) {
    if (k in values) {
      cols.push(k);
      vals.push(values[k] ?? null);
    }
  }
  const placeholders = cols.map(() => '?').join(', ');
  await query(
    `INSERT INTO metric_snapshots (${cols.join(', ')}) VALUES (${placeholders})`,
    vals
  );
}

// ─── current_value refresh ────────────────────────────────────────────────────

describe('refreshOutcomeTreeHealth: current_value propagation', () => {
  it('updates current_value from latest snapshot for matching metric_key', async () => {
    const branch = await addBranch(productId, {
      label: 'Reach 100 paid users',
      metric_key: 'active_users',
      target_value: 100,
      kill_criterion: 'if active_users < 30 by Q3',
    });
    await insertSnapshot({ snapshot_date: '2026-05-04', active_users: 42 });

    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.refreshed).toBe(1);

    const after = await getBranch(branch.id);
    expect(after?.current_value).toBe(42);
  });

  it('uses the latest snapshot when multiple exist', async () => {
    const branch = await addBranch(productId, {
      label: 'Signups',
      metric_key: 'signups_7d',
      target_value: 200,
      kill_criterion: 'if signups < 50',
    });
    await insertSnapshot({ snapshot_date: '2026-04-27', signups_7d: 10 });
    await insertSnapshot({ snapshot_date: '2026-05-04', signups_7d: 75 });

    await refreshOutcomeTreeHealth(productId);
    const after = await getBranch(branch.id);
    expect(after?.current_value).toBe(75);
  });

  it('leaves branches with unsupported metric_key alone', async () => {
    const branch = await addBranch(productId, {
      label: 'NPS Index',
      metric_key: 'made_up_metric', // not in whitelist
      target_value: 50,
      kill_criterion: 'if metric below 0',
    });
    await insertSnapshot({ snapshot_date: '2026-05-04', signups_7d: 99 });

    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.refreshed).toBe(0);

    const after = await getBranch(branch.id);
    expect(after?.current_value).toBeNull();
  });

  it('no-op when no metric_snapshots exist', async () => {
    const branch = await addBranch(productId, {
      label: 'Whatever',
      metric_key: 'active_users',
      target_value: 10,
      kill_criterion: 'if zero',
    });
    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.refreshed).toBe(0);
    expect(r.superseded).toBe(0);
    const after = await getBranch(branch.id);
    expect(after?.current_value).toBeNull();
  });
});

// ─── Stale supersede ──────────────────────────────────────────────────────────

describe('refreshOutcomeTreeHealth: stale branches', () => {
  it('marks active branches >90 days old with null current_value as superseded', async () => {
    const branch = await addBranch(productId, {
      label: 'Stale goal',
      metric_key: null, // unmeasured
      target_value: null,
      kill_criterion: 'if not pursued in 90 days',
    });
    // Force the branch's generated_at into the past.
    await query(
      `UPDATE outcome_trees SET generated_at = datetime('now', '-100 days') WHERE id = ?`,
      [branch.id]
    );

    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.superseded).toBe(1);

    const after = await getBranch(branch.id);
    expect(after?.status).toBe('superseded');
    expect(after?.killed_reason).toMatch(/auto-superseded/);
  });

  it('does not supersede a young branch with null current_value', async () => {
    const branch = await addBranch(productId, {
      label: 'New goal',
      metric_key: null,
      kill_criterion: 'too early',
    });
    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.superseded).toBe(0);
    const after = await getBranch(branch.id);
    expect(after?.status).toBe('active');
  });

  it('does not supersede an old branch that has a current_value', async () => {
    const branch = await addBranch(productId, {
      label: 'Tracked goal',
      metric_key: 'active_users',
      current_value: 80,
      target_value: 100,
      kill_criterion: 'if zero',
    });
    await query(
      `UPDATE outcome_trees SET generated_at = datetime('now', '-100 days') WHERE id = ?`,
      [branch.id]
    );

    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.superseded).toBe(0);
    const after = await getBranch(branch.id);
    expect(after?.status).toBe('active');
  });
});

// ─── Counts ───────────────────────────────────────────────────────────────────

describe('refreshOutcomeTreeHealth: count reporting', () => {
  it('reports total_active, killed_30d, achieved_30d', async () => {
    await addBranch(productId, {
      label: 'a1',
      metric_key: null,
      kill_criterion: 'k',
    });
    await addBranch(productId, {
      label: 'a2',
      metric_key: null,
      kill_criterion: 'k',
    });
    // Insert one killed-recent and one achieved-recent
    await query(
      `INSERT INTO outcome_trees
       (id, product_id, label, kill_criterion, status, killed_at, generated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '-3 days'), datetime('now'))`,
      [nanoid(), productId, 'killed', 'k', 'killed']
    );
    await query(
      `INSERT INTO outcome_trees
       (id, product_id, label, kill_criterion, status, achieved_at, generated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '-3 days'), datetime('now'))`,
      [nanoid(), productId, 'achieved', 'k', 'achieved']
    );

    const r = await refreshOutcomeTreeHealth(productId);
    expect(r.total_active).toBe(2);
    expect(r.killed_30d).toBe(1);
    expect(r.achieved_30d).toBe(1);
  });
});
