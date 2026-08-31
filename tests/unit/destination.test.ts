// =============================================================================
// Tests: V3.1 Layer A — Destination (North Star + Outcome Tree)
// Verifies Sage's rule (kill_criterion required), gap computation, and
// briefing context formatting.
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
import {
  addBranch,
  getBranch,
  getActiveTree,
  getRootBranches,
  getChildren,
  killBranch,
  achieveBranch,
  updateCurrentValue,
  supersedePriorTree,
  getTreeHealth,
} from '../../src/services/destination/outcome-tree.js';
import { buildDestinationContext } from '../../src/services/destination/briefing-context.js';

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

// ─── Outcome Tree: Sage's Rule ────────────────────────────────────────────────

describe("outcome_trees: Sage's rule (kill_criterion required)", () => {
  it('rejects empty kill_criterion', async () => {
    await expect(
      addBranch(productId, {
        label: 'Acquisition',
        kill_criterion: '',
      })
    ).rejects.toThrow(/kill_criterion is required/);
  });

  it('rejects whitespace-only kill_criterion', async () => {
    await expect(
      addBranch(productId, {
        label: 'Acquisition',
        kill_criterion: '   ',
      })
    ).rejects.toThrow(/kill_criterion is required/);
  });

  it('accepts non-empty kill_criterion', async () => {
    const branch = await addBranch(productId, {
      label: 'Acquisition',
      kill_criterion: 'if <50 trial signups by Q3, kill',
    });
    expect(branch.id).toBeTruthy();
    expect(branch.kill_criterion).toBe('if <50 trial signups by Q3, kill');
    expect(branch.status).toBe('active');
  });
});

describe('outcome_trees: parent validation', () => {
  it('rejects branch with non-existent parent', async () => {
    await expect(
      addBranch(productId, {
        parent_branch_id: 'does-not-exist',
        label: 'Child',
        kill_criterion: 'if X',
      })
    ).rejects.toThrow(/parent branch .* not found/);
  });

  it('rejects branch whose parent belongs to a different product', async () => {
    const root = await addBranch(productId, {
      label: 'Root for product A',
      kill_criterion: 'if X',
    });
    const { productId: otherProductId } = await createFounderAndProduct();
    await expect(
      addBranch(otherProductId, {
        parent_branch_id: root.id,
        label: 'Cross-product child',
        kill_criterion: 'if Y',
      })
    ).rejects.toThrow(/different product/);
  });

  it('accepts branch with valid same-product parent', async () => {
    const root = await addBranch(productId, {
      label: 'Acquisition',
      kill_criterion: 'if X',
    });
    const child = await addBranch(productId, {
      parent_branch_id: root.id,
      label: 'Trial signups',
      kill_criterion: 'if <50 by Q3',
    });
    expect(child.parent_branch_id).toBe(root.id);
  });
});

// ─── Outcome Tree: Lifecycle ──────────────────────────────────────────────────

describe('outcome_trees: lifecycle transitions', () => {
  it('killBranch sets status, killed_at, killed_reason', async () => {
    const b = await addBranch(productId, {
      label: 'Branch',
      kill_criterion: 'if X',
    });
    await killBranch(b.id, 'cohort below threshold');
    const after = await getBranch(b.id);
    expect(after?.status).toBe('killed');
    expect(after?.killed_reason).toBe('cohort below threshold');
    expect(after?.killed_at).toBeTruthy();
  });

  it('killBranch requires a non-empty reason', async () => {
    const b = await addBranch(productId, {
      label: 'Branch',
      kill_criterion: 'if X',
    });
    await expect(killBranch(b.id, '')).rejects.toThrow(/killed_reason is required/);
  });

  it('achieveBranch sets status and achieved_at', async () => {
    const b = await addBranch(productId, {
      label: 'Branch',
      kill_criterion: 'if X',
    });
    await achieveBranch(b.id);
    const after = await getBranch(b.id);
    expect(after?.status).toBe('achieved');
    expect(after?.achieved_at).toBeTruthy();
  });

  it('updateCurrentValue updates only current_value', async () => {
    const b = await addBranch(productId, {
      label: 'Branch',
      target_value: 100,
      kill_criterion: 'if X',
    });
    await updateCurrentValue(b.id, 42);
    const after = await getBranch(b.id);
    expect(after?.current_value).toBe(42);
    expect(after?.target_value).toBe(100);
  });

  it('supersedePriorTree marks active branches from prior runs as superseded', async () => {
    const oldRunId = 'run-old';
    const newRunId = 'run-new';
    await addBranch(productId, {
      label: 'Old A',
      kill_criterion: 'if X',
      weekly_refresh_run_id: oldRunId,
    });
    await addBranch(productId, {
      label: 'Old B',
      kill_criterion: 'if X',
      weekly_refresh_run_id: oldRunId,
    });
    const affected = await supersedePriorTree(productId, newRunId);
    expect(affected).toBe(2);
    const tree = await getActiveTree(productId);
    expect(tree).toHaveLength(0);
  });
});

// ─── Outcome Tree: Reads ──────────────────────────────────────────────────────

describe('outcome_trees: reads', () => {
  it('getActiveTree only returns active branches', async () => {
    const a = await addBranch(productId, { label: 'A', kill_criterion: 'if X' });
    await addBranch(productId, { label: 'B', kill_criterion: 'if Y' });
    await killBranch(a.id, 'cohort below threshold');
    const tree = await getActiveTree(productId);
    expect(tree.map(b => b.label).sort()).toEqual(['B']);
  });

  it('getRootBranches returns only branches with NULL parent', async () => {
    const root = await addBranch(productId, { label: 'Root', kill_criterion: 'if X' });
    await addBranch(productId, {
      parent_branch_id: root.id,
      label: 'Child',
      kill_criterion: 'if Y',
    });
    const roots = await getRootBranches(productId);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.label).toBe('Root');
  });

  it('getChildren returns only direct children', async () => {
    const root = await addBranch(productId, { label: 'Root', kill_criterion: 'if X' });
    const c1 = await addBranch(productId, {
      parent_branch_id: root.id,
      label: 'C1',
      kill_criterion: 'if Y',
    });
    await addBranch(productId, {
      parent_branch_id: c1.id,
      label: 'GC',
      kill_criterion: 'if Z',
    });
    const children = await getChildren(root.id);
    expect(children).toHaveLength(1);
    expect(children[0]!.label).toBe('C1');
  });
});

// ─── Tree Health ──────────────────────────────────────────────────────────────

describe('outcome_trees: getTreeHealth', () => {
  it('counts active branches and gaps', async () => {
    await addBranch(productId, {
      label: 'A',
      target_value: 100,
      metric_key: 'mrr',
      kill_criterion: 'if X',
    });
    await addBranch(productId, {
      label: 'B (no metric, no target)',
      kill_criterion: 'if Y',
    });
    const health = await getTreeHealth(productId);
    expect(health.total_active).toBe(2);
    expect(health.branches_without_metric).toBe(1);
    expect(health.branches_without_target).toBe(1);
  });

  it('counts killed_30d and achieved_30d', async () => {
    const a = await addBranch(productId, { label: 'A', kill_criterion: 'if X' });
    const b = await addBranch(productId, { label: 'B', kill_criterion: 'if Y' });
    await killBranch(a.id, 'reason');
    await achieveBranch(b.id);
    const health = await getTreeHealth(productId);
    expect(health.killed_30d).toBe(1);
    expect(health.achieved_30d).toBe(1);
  });
});

// ─── Briefing Context ─────────────────────────────────────────────────────────

describe('briefing-context: buildDestinationContext', () => {
  it('returns empty context when no north star is set', async () => {
    const ctx = await buildDestinationContext(productId);
    expect(ctx.has_north_star).toBe(false);
    expect(ctx.briefing_block).toBe('');
    expect(ctx.top_branches).toEqual([]);
  });

  it('builds a populated context with summary, progress lines, and branches', async () => {
    await upsertNorthStar(productId, {
      arr_target_dollars: 600_000,
      paying_accounts_target: 50,
      target_date: '2027-05-07',
      destination_summary: 'Hit $50K MRR with 50 paying accounts.',
    });
    await addBranch(productId, {
      label: 'Acquisition: 200 trial signups/mo',
      target_value: 200,
      current_value: 50,
      kill_criterion: 'if <50 by Q3',
    });
    await addBranch(productId, {
      label: 'Activation: 30% trial→paid',
      target_value: 30,
      current_value: 18,
      kill_criterion: 'if <15% by Q3',
    });
    const ctx = await buildDestinationContext(productId);
    expect(ctx.has_north_star).toBe(true);
    expect(ctx.north_star_summary).toContain('$50K MRR');
    expect(ctx.briefing_block).toContain('North Star:');
    expect(ctx.briefing_block).toContain('$600K');
    expect(ctx.top_branches.length).toBeGreaterThan(0);
    // Lowest-progress branch first
    expect(ctx.top_branches[0]!.label).toContain('Acquisition');
  });

  it('handles missing target gracefully', async () => {
    await upsertNorthStar(productId, {
      destination_summary: 'no targets yet',
    });
    const ctx = await buildDestinationContext(productId);
    expect(ctx.has_north_star).toBe(true);
    expect(ctx.arr_progress_line).toBeNull();
    expect(ctx.paying_progress_line).toBeNull();
    expect(ctx.briefing_block).toContain('no targets yet');
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
