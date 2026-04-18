// =============================================================================
// FOUNDRY — Knowledge Graph Engine
// Entity/relationship management, multi-hop reasoning, causal chain discovery.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export type EntityType = 'customer' | 'competitor' | 'decision' | 'stressor' | 'metric' | 'feature' | 'channel' | 'cohort' | 'experiment';

export interface GraphEntity {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface Relationship {
  source: GraphEntity;
  target: GraphEntity;
  relationship_type: string;
  weight: number;
  evidence: string;
}

export interface CausalChain {
  id: string;
  chain_description: string;
  hops: Array<{ from: string; to: string; relationship: string }>;
  root_cause: string;
  effect: string;
  confidence: number;
  actionable_insight: string;
}

/**
 * Register an entity in the graph.
 */
export async function upsertEntity(
  productId: string,
  entityType: EntityType,
  entityId: string,
  label: string,
  properties?: Record<string, unknown>
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO graph_entities (id, product_id, entity_type, entity_id, label, properties)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, entity_type, entity_id) DO UPDATE SET
       label = excluded.label, properties = excluded.properties`,
    [id, productId, entityType, entityId, label, properties ? JSON.stringify(properties) : null]
  );

  // Return the actual ID (might be existing)
  const result = await query(
    'SELECT id FROM graph_entities WHERE product_id = ? AND entity_type = ? AND entity_id = ?',
    [productId, entityType, entityId]
  );
  return (result.rows[0] as Record<string, string>)?.id ?? id;
}

/**
 * Create a relationship between two entities.
 */
export async function addRelationship(
  productId: string,
  sourceEntityId: string,
  targetEntityId: string,
  relationshipType: string,
  weight: number = 1.0,
  evidence?: string
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO graph_relationships (id, product_id, source_entity_id, target_entity_id, relationship_type, weight, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, sourceEntityId, targetEntityId, relationshipType, weight, evidence ?? null]
  );
  return id;
}

/**
 * Populate the graph from existing product data.
 */
export async function buildProductGraph(productId: string): Promise<{
  entities: number;
  relationships: number;
}> {
  let entities = 0;
  let relationships = 0;

  // Add customers
  const customers = await query('SELECT id, name, email, plan, churn_risk FROM customers WHERE product_id = ?', [productId]);
  for (const row of customers.rows as unknown as Array<Record<string, unknown>>) {
    await upsertEntity(productId, 'customer', row.id as string, (row.name as string) ?? (row.email as string) ?? 'Unknown', { plan: row.plan, churn_risk: row.churn_risk });
    entities++;
  }

  // Add competitors
  const competitors = await query('SELECT id, name, positioning FROM competitors WHERE product_id = ?', [productId]);
  for (const row of competitors.rows as unknown as Array<Record<string, string>>) {
    await upsertEntity(productId, 'competitor', row.id, row.name, { positioning: row.positioning });
    entities++;
  }

  // Add decisions
  const decisions = await query(
    "SELECT id, what, category, status FROM decisions WHERE product_id = ? AND status != 'pending' ORDER BY decided_at DESC LIMIT 50",
    [productId]
  );
  for (const row of decisions.rows as unknown as Array<Record<string, string>>) {
    await upsertEntity(productId, 'decision', row.id, row.what, { category: row.category, status: row.status });
    entities++;
  }

  // Add stressors
  const stressors = await query('SELECT id, stressor_name, severity, status FROM stressor_history WHERE product_id = ? ORDER BY identified_at DESC LIMIT 30', [productId]);
  for (const row of stressors.rows as unknown as Array<Record<string, string>>) {
    await upsertEntity(productId, 'stressor', row.id, row.stressor_name, { severity: row.severity, status: row.status });
    entities++;
  }

  // Build relationships: competitive signals → competitors
  const signals = await query(
    'SELECT cs.id, cs.competitor_name, cs.linked_stressor_id FROM competitive_signals cs WHERE cs.product_id = ?',
    [productId]
  );
  for (const row of signals.rows as unknown as Array<Record<string, string>>) {
    if (row.linked_stressor_id) {
      const compEntity = await query(
        "SELECT id FROM graph_entities WHERE product_id = ? AND entity_type = 'competitor' AND label = ?",
        [productId, row.competitor_name]
      );
      const stressorEntity = await query(
        "SELECT id FROM graph_entities WHERE product_id = ? AND entity_type = 'stressor' AND entity_id = ?",
        [productId, row.linked_stressor_id]
      );
      if (compEntity.rows.length > 0 && stressorEntity.rows.length > 0) {
        await addRelationship(
          productId,
          (compEntity.rows[0] as Record<string, string>).id,
          (stressorEntity.rows[0] as Record<string, string>).id,
          'caused_stressor', 0.8, 'Competitive signal triggered stressor'
        );
        relationships++;
      }
    }
  }

  return { entities, relationships };
}

/**
 * Discover causal chains using multi-hop graph traversal + AI reasoning.
 */
export async function discoverCausalChains(productId: string): Promise<CausalChain[]> {
  // Get all entities and relationships
  const entities = await query(
    'SELECT * FROM graph_entities WHERE product_id = ? LIMIT 200',
    [productId]
  );
  const rels = await query(
    'SELECT r.*, s.label as source_label, s.entity_type as source_type, t.label as target_label, t.entity_type as target_type FROM graph_relationships r JOIN graph_entities s ON r.source_entity_id = s.id JOIN graph_entities t ON r.target_entity_id = t.id WHERE r.product_id = ?',
    [productId]
  );

  if (rels.rows.length < 3) return [];

  const prompt = `Analyze this product's knowledge graph for causal chains (multi-hop relationships that explain root causes of problems or opportunities).

Entities (${entities.rows.length}):
${(entities.rows as unknown as Array<Record<string, string>>).slice(0, 50).map((e) =>
  `[${e.entity_type}] ${e.label}`
).join('\n')}

Relationships (${rels.rows.length}):
${(rels.rows as unknown as Array<Record<string, string>>).slice(0, 50).map((r) =>
  `${r.source_label} -[${r.relationship_type}]-> ${r.target_label}`
).join('\n')}

Find 1-3 causal chains where A causes B causes C (multi-hop). Focus on non-obvious connections.

Return JSON:
[{
  "chain_description": "human-readable explanation",
  "hops": [{"from": "entity A", "to": "entity B", "relationship": "causes"}],
  "root_cause": "the starting entity",
  "effect": "the end entity",
  "confidence": 0.0-1.0,
  "actionable_insight": "what the founder should do about this"
}]`;

  const response = await callOpus(
    'You are a causal reasoning analyst. Find non-obvious multi-hop causal chains in business data.',
    prompt,
    4096
  );

  const chains = parseJSONResponse<Array<{
    chain_description: string;
    hops: Array<{ from: string; to: string; relationship: string }>;
    root_cause: string;
    effect: string;
    confidence: number;
    actionable_insight: string;
  }>>(response.content);

  // Persist
  const results: CausalChain[] = [];
  for (const chain of chains) {
    const id = nanoid();
    await query(
      `INSERT INTO causal_chains (id, product_id, chain_description, hops, root_cause_entity_id, effect_entity_id, confidence, actionable_insight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, productId, chain.chain_description, JSON.stringify(chain.hops), null, null, chain.confidence, chain.actionable_insight]
    );
    results.push({ id, ...chain });
  }

  return results;
}

/**
 * Query the graph: find all entities connected to a given entity within N hops.
 */
export async function queryNeighborhood(
  productId: string,
  entityId: string,
  maxHops: number = 2
): Promise<{ entities: GraphEntity[]; relationships: Relationship[] }> {
  // BFS from the starting entity
  const visited = new Set<string>();
  const queue: Array<{ entityId: string; depth: number }> = [{ entityId, depth: 0 }];
  const resultEntities: GraphEntity[] = [];
  const resultRels: Relationship[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.entityId) || current.depth > maxHops) continue;
    visited.add(current.entityId);

    const entity = await query('SELECT * FROM graph_entities WHERE id = ?', [current.entityId]);
    const e = entity.rows[0] as Record<string, unknown> | undefined;
    if (e) {
      resultEntities.push({
        id: e.id as string, entity_type: e.entity_type as EntityType,
        entity_id: e.entity_id as string, label: e.label as string,
        properties: e.properties ? JSON.parse(e.properties as string) : {},
      });
    }

    // Get outgoing and incoming relationships
    const outgoing = await query(
      'SELECT * FROM graph_relationships WHERE source_entity_id = ? AND product_id = ?',
      [current.entityId, productId]
    );
    const incoming = await query(
      'SELECT * FROM graph_relationships WHERE target_entity_id = ? AND product_id = ?',
      [current.entityId, productId]
    );

    for (const rel of [...outgoing.rows, ...incoming.rows] as unknown as Array<Record<string, unknown>>) {
      const nextId = rel.source_entity_id === current.entityId
        ? rel.target_entity_id as string
        : rel.source_entity_id as string;
      if (!visited.has(nextId)) {
        queue.push({ entityId: nextId, depth: current.depth + 1 });
      }
    }
  }

  return { entities: resultEntities, relationships: resultRels };
}
