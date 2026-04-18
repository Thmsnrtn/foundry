-- =============================================================================
-- Migration 032: Knowledge Graph
-- Entities, relationships, and causal chains for multi-hop reasoning.
-- =============================================================================

CREATE TABLE IF NOT EXISTS graph_entities (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  properties TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS graph_relationships (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL REFERENCES graph_entities(id),
  target_entity_id TEXT NOT NULL REFERENCES graph_entities(id),
  relationship_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  evidence TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS causal_chains (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  chain_description TEXT NOT NULL,
  hops TEXT NOT NULL,
  root_cause_entity_id TEXT,
  effect_entity_id TEXT,
  confidence REAL,
  actionable_insight TEXT,
  discovered_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_graph_entities ON graph_entities(product_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_graph_rels_source ON graph_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_rels_target ON graph_relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_rels_product ON graph_relationships(product_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_causal_chains ON causal_chains(product_id);
