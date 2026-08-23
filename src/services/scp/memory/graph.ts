// =============================================================================
// FOUNDRY — Memory Graph Service
// Queryable graph of decisions, outcomes, and context snapshots.
// Each node captures institutional knowledge; edges encode causal/informational
// relationships. Supports the Decision Archaeology interface.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { likeContains } from '../../../lib/sql-like.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryNode {
  id: string;
  node_type: 'decision' | 'outcome' | 'context_snapshot' | 'hypothesis';
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  source_id: string | null;
  source_type: string | null;
  occurred_at: string;
}

export interface MemoryEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: 'caused' | 'informed_by' | 'led_to' | 'contradicts' | 'supports';
  weight: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToNode(row: Record<string, unknown>): MemoryNode {
  let metadata: Record<string, unknown> = {};
  if (row.metadata_json && typeof row.metadata_json === 'string') {
    try { metadata = JSON.parse(row.metadata_json) as Record<string, unknown>; } catch { /* leave empty */ }
  }
  return {
    id: row.id as string,
    node_type: row.node_type as MemoryNode['node_type'],
    title: row.title as string,
    content: row.content as string,
    metadata,
    source_id: (row.source_id as string | null) ?? null,
    source_type: (row.source_type as string | null) ?? null,
    occurred_at: row.occurred_at as string,
  };
}

function rowToEdge(row: Record<string, unknown>): MemoryEdge {
  return {
    id: row.id as string,
    from_node_id: row.from_node_id as string,
    to_node_id: row.to_node_id as string,
    edge_type: row.edge_type as MemoryEdge['edge_type'],
    weight: Number(row.weight) || 1.0,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a new node to the memory graph. Returns the new node's ID.
 */
export async function addMemoryNode(
  productId: string,
  node: Omit<MemoryNode, 'id'>
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO memory_nodes
       (id, product_id, node_type, title, content, metadata_json, source_id, source_type, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      node.node_type,
      node.title,
      node.content,
      JSON.stringify(node.metadata ?? {}),
      node.source_id ?? null,
      node.source_type ?? null,
      node.occurred_at,
    ]
  );
  return id;
}

/**
 * Add a directed edge between two memory nodes. Returns the new edge's ID.
 */
export async function addMemoryEdge(
  productId: string,
  edge: Omit<MemoryEdge, 'id'>
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO memory_edges (id, product_id, from_node_id, to_node_id, edge_type, weight)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, productId, edge.from_node_id, edge.to_node_id, edge.edge_type, edge.weight ?? 1.0]
  );
  return id;
}

/**
 * Fetch a single node by ID.
 */
export async function getNode(nodeId: string): Promise<MemoryNode | null> {
  const result = await query(
    `SELECT * FROM memory_nodes WHERE id = ?`,
    [nodeId]
  );
  if (result.rows.length === 0) return null;
  return rowToNode(result.rows[0] as Record<string, unknown>);
}

/**
 * BFS traversal: fetch the node plus all nodes reachable within `depth` hops.
 * Also returns all edges traversed.
 */
export async function getConnectedNodes(
  nodeId: string,
  depth = 2
): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[] }> {
  const visited = new Set<string>([nodeId]);
  const frontier = [nodeId];
  const allEdges: MemoryEdge[] = [];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const placeholders = frontier.map(() => '?').join(',');
    const edgesResult = await query(
      `SELECT * FROM memory_edges
       WHERE from_node_id IN (${placeholders})
          OR to_node_id   IN (${placeholders})`,
      [...frontier, ...frontier]
    );

    const newFrontier: string[] = [];
    for (const row of edgesResult.rows) {
      const edge = rowToEdge(row as Record<string, unknown>);
      allEdges.push(edge);
      for (const id of [edge.from_node_id, edge.to_node_id]) {
        if (!visited.has(id)) {
          visited.add(id);
          newFrontier.push(id);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...newFrontier);
  }

  const allNodeIds = [...visited];
  const placeholders = allNodeIds.map(() => '?').join(',');
  const nodesResult = await query(
    `SELECT * FROM memory_nodes WHERE id IN (${placeholders})`,
    allNodeIds
  );
  const nodes = nodesResult.rows.map(r => rowToNode(r as Record<string, unknown>));

  return { nodes, edges: allEdges };
}

/**
 * Simple full-text search across title and content using LIKE.
 */
export async function searchMemory(
  productId: string,
  query_str: string
): Promise<MemoryNode[]> {
  // A founder searching for "50% week" is searching for that text, not for a
  // wildcard in the middle of it.
  const like = likeContains(query_str);
  const result = await query(
    `SELECT * FROM memory_nodes
     WHERE product_id = ?
       AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
     ORDER BY occurred_at DESC
     LIMIT 50`,
    [productId, like, like]
  );
  return result.rows.map(r => rowToNode(r as Record<string, unknown>));
}

/**
 * Fetch the most recent N nodes for a product.
 */
export async function getRecentNodes(
  productId: string,
  limit = 30
): Promise<MemoryNode[]> {
  const result = await query(
    `SELECT * FROM memory_nodes
     WHERE product_id = ?
     ORDER BY occurred_at DESC
     LIMIT ?`,
    [productId, limit]
  );
  return result.rows.map(r => rowToNode(r as Record<string, unknown>));
}

/**
 * Import all rows from strategic_decisions_log into memory_nodes.
 * De-duplicates on source_id so it is safe to call repeatedly.
 * Returns the count of newly inserted nodes.
 */
export async function syncDecisionsToMemory(productId: string): Promise<number> {
  // Fetch all strategic decisions for this product
  const decisionsResult = await query(
    `SELECT id, decision_title, decision_description, decision_rationale,
            expected_outcome, decision_category, made_by, confidence_at_decision,
            status, actual_outcome, agent_context_json, made_at
     FROM strategic_decisions_log
     WHERE product_id = ?
     ORDER BY made_at ASC`,
    [productId]
  );

  // Get already-synced source_ids to avoid duplicates
  const existingResult = await query(
    `SELECT source_id FROM memory_nodes
     WHERE product_id = ? AND source_type = 'strategic_decision' AND source_id IS NOT NULL`,
    [productId]
  );
  const existingIds = new Set(
    existingResult.rows.map(r => (r as Record<string, unknown>).source_id as string)
  );

  let inserted = 0;
  for (const row of decisionsResult.rows) {
    const r = row as Record<string, unknown>;
    if (existingIds.has(r.id as string)) continue;

    let agentContext: Record<string, unknown> = {};
    if (r.agent_context_json && typeof r.agent_context_json === 'string') {
      try { agentContext = JSON.parse(r.agent_context_json) as Record<string, unknown>; } catch { /* ignore */ }
    }

    const contentParts: string[] = [
      r.decision_description as string,
    ];
    if (r.decision_rationale) contentParts.push(`**Rationale:** ${r.decision_rationale as string}`);
    if (r.expected_outcome) contentParts.push(`**Expected outcome:** ${r.expected_outcome as string}`);
    if (r.actual_outcome) contentParts.push(`**Actual outcome:** ${r.actual_outcome as string}`);

    const metadata: Record<string, unknown> = {
      category: r.decision_category,
      made_by: r.made_by,
      confidence: r.confidence_at_decision,
      status: r.status,
      agent_context: agentContext,
    };

    await addMemoryNode(productId, {
      node_type: 'decision',
      title: r.decision_title as string,
      content: contentParts.join('\n\n'),
      metadata,
      source_id: r.id as string,
      source_type: 'strategic_decision',
      occurred_at: r.made_at as string,
    });
    inserted++;
  }

  return inserted;
}
