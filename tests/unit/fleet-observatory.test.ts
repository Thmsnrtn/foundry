// =============================================================================
// Tests: FleetObservatory overview (Phase 4.2)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { getFleetOverview } from '../../src/services/fleet/observatory.js';
import { nanoid } from 'nanoid';

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
});

beforeEach(async () => {
  // CHILDREN BEFORE PARENTS. The real schema has foreign keys, and not all of
  // them cascade — so deleting products while its agent rows and decisions
  // still exist raises. The hand-written stand-in had no keys at all, which is
  // why the order never mattered here before.
  await executeRaw('DELETE FROM agent_instances');
  await executeRaw('DELETE FROM decisions');
  await executeRaw('DELETE FROM products');
  // Real products rows have an owner; the stand-in did not, so every product
  // in this file belonged to a founder that does not exist.
  await query(
    `INSERT OR IGNORE INTO founders (id, clerk_user_id, email)
     VALUES ('f1','clerk_f1','f1@test.local'), ('f2','clerk_f2','f2@test.local'),
            ('other','clerk_other','other@test.local')`);
});

async function addProduct(id: string, owner: string, name: string, status = 'active'): Promise<void> {
  await query(`INSERT INTO products (id, name, owner_id, status, scp_status) VALUES (?, ?, ?, ?, 'active')`, [id, name, owner, status]);
}
async function addAgent(pid: string, name: string, status: string, health: number): Promise<void> {
  await query(
    `INSERT INTO agent_instances (id, product_id, agent_name, display_name, status, last_run_at, next_run_at, domain_health_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), pid, name, name.toUpperCase(), status, '2026-07-01T00:00:00Z', '2026-07-09T00:00:00Z', health],
  );
}

describe('getFleetOverview', () => {
  it('aggregates agents and pending decisions across a founder\'s products', async () => {
    await addProduct('p1', 'f1', 'Alpha');
    await addProduct('p2', 'f1', 'Beta');
    await addProduct('pX', 'other', 'NotMine');
    await addAgent('p1', 'atlas', 'active', 80);
    await addAgent('p1', 'forge', 'paused', 30);
    await addAgent('p2', 'oracle', 'active', 60);
    for (const status of ['pending', 'approved']) {
      await query(
        `INSERT INTO decisions (id, product_id, what, why_now, status)
         VALUES (?, 'p1', 'ship it', 'the window is now', ?)`, [nanoid(), status]);
    }

    const fleet = await getFleetOverview('f1');
    expect(fleet.totals.products).toBe(2);
    expect(fleet.totals.agents).toBe(3);
    expect(fleet.totals.activeAgents).toBe(2);
    expect(fleet.totals.pendingDecisions).toBe(1);

    const alpha = fleet.products.find((p) => p.productId === 'p1')!;
    expect(alpha.agents).toHaveLength(2);
    expect(alpha.pendingDecisions).toBe(1);
    // Products the founder doesn't own are excluded.
    expect(fleet.products.find((p) => p.productId === 'pX')).toBeUndefined();
  });

  it('excludes archived products and returns empty totals when none', async () => {
    await addProduct('p1', 'f2', 'Archived', 'archived');
    const fleet = await getFleetOverview('f2');
    expect(fleet.products).toHaveLength(0);
    expect(fleet.totals).toEqual({ products: 0, agents: 0, activeAgents: 0, pendingDecisions: 0 });
  });
});
