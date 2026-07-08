// =============================================================================
// Tests: FleetObservatory overview (Phase 4.2)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { getFleetOverview } from '../../src/services/fleet/observatory.js';
import { nanoid } from 'nanoid';

beforeAll(async () => {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, status TEXT DEFAULT 'active', scp_status TEXT DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS agent_instances (id TEXT PRIMARY KEY, product_id TEXT, agent_name TEXT, display_name TEXT, status TEXT, last_run_at TEXT, next_run_at TEXT, domain_health_score INTEGER);
    CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, product_id TEXT, status TEXT);
  `);
});

beforeEach(async () => {
  await executeRaw('DELETE FROM products');
  await executeRaw('DELETE FROM agent_instances');
  await executeRaw('DELETE FROM decisions');
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
    await query(`INSERT INTO decisions (id, product_id, status) VALUES (?, 'p1', 'pending')`, [nanoid()]);
    await query(`INSERT INTO decisions (id, product_id, status) VALUES (?, 'p1', 'approved')`, [nanoid()]);

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
