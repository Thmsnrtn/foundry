// =============================================================================
// FOUNDRY — FleetObservatory (Phase 4.2)
// A read-only control room for multi-product founders: every agent's status,
// last/next run, and health, plus pending decisions, across all their products.
// Reads existing tables (products, agent_instances, decisions) — no new writes.
// =============================================================================

import { query, getVisibleProducts } from '../../db/client.js';

export interface FleetAgent {
  agentName: string;
  displayName: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  healthScore: number | null;
}

export interface FleetProduct {
  productId: string;
  productName: string;
  scpStatus: string | null;
  pendingDecisions: number;
  agents: FleetAgent[];
  /** Soonest upcoming agent run across this product, for sorting. */
  nextRunAt: string | null;
}

export interface FleetOverview {
  products: FleetProduct[];
  totals: { products: number; agents: number; activeAgents: number; pendingDecisions: number };
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

/**
 * Assemble the fleet overview for a founder. Three bounded queries (products,
 * their agents, their pending-decision counts) — no per-product N+1.
 */
export async function getFleetOverview(founderId: string): Promise<FleetOverview> {
  // EVERY COMPANY THIS PERSON MAY SEE, not only the ones they own. This read
  // `WHERE owner_id = ?`, so an invited co-founder opened the Fleet Observatory
  // — "every agent's status across all of a founder's products" — and saw
  // nothing, while every other page in the product showed them the company they
  // had been accepted into. `getVisibleProducts` is where that rule lives; the
  // fleet's own choice to show only ACTIVE companies is applied after it.
  const visible = await getVisibleProducts(founderId);
  const products = (visible.rows as Array<Record<string, unknown>>)
    .filter((p) => p.status === 'active')
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  if (products.length === 0) {
    return { products: [], totals: { products: 0, agents: 0, activeAgents: 0, pendingDecisions: 0 } };
  }

  const productIds = products.map((p) => p.id as string);

  const agentsResult = await query(
    `SELECT product_id, agent_name, display_name, status, last_run_at, next_run_at, domain_health_score
       FROM agent_instances
      WHERE product_id IN (${placeholders(productIds.length)})
      ORDER BY agent_name ASC`,
    productIds,
  );

  const decisionsResult = await query(
    `SELECT product_id, COUNT(*) AS cnt
       FROM decisions
      WHERE product_id IN (${placeholders(productIds.length)}) AND status = 'pending'
      GROUP BY product_id`,
    productIds,
  );
  const pendingByProduct = new Map<string, number>();
  for (const row of decisionsResult.rows as Array<Record<string, unknown>>) {
    pendingByProduct.set(row.product_id as string, Number(row.cnt));
  }

  const agentsByProduct = new Map<string, FleetAgent[]>();
  for (const row of agentsResult.rows as Array<Record<string, unknown>>) {
    const pid = row.product_id as string;
    const list = agentsByProduct.get(pid) ?? [];
    list.push({
      agentName: row.agent_name as string,
      displayName: (row.display_name as string) ?? (row.agent_name as string),
      status: (row.status as string) ?? 'active',
      lastRunAt: (row.last_run_at as string | null) ?? null,
      nextRunAt: (row.next_run_at as string | null) ?? null,
      healthScore: row.domain_health_score != null ? Number(row.domain_health_score) : null,
    });
    agentsByProduct.set(pid, list);
  }

  let totalAgents = 0;
  let activeAgents = 0;
  let totalPending = 0;

  const fleetProducts: FleetProduct[] = products.map((p) => {
    const pid = p.id as string;
    const agents = agentsByProduct.get(pid) ?? [];
    const pending = pendingByProduct.get(pid) ?? 0;
    totalAgents += agents.length;
    activeAgents += agents.filter((a) => a.status === 'active').length;
    totalPending += pending;
    const nextRuns = agents.map((a) => a.nextRunAt).filter((x): x is string => !!x).sort();
    return {
      productId: pid,
      productName: p.name as string,
      scpStatus: (p.scp_status as string | null) ?? null,
      pendingDecisions: pending,
      agents,
      nextRunAt: nextRuns[0] ?? null,
    };
  });

  return {
    products: fleetProducts,
    totals: {
      products: fleetProducts.length,
      agents: totalAgents,
      activeAgents,
      pendingDecisions: totalPending,
    },
  };
}
