CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  node_type TEXT NOT NULL, -- 'decision' | 'outcome' | 'context_snapshot' | 'hypothesis'
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- full markdown content
  metadata_json TEXT, -- type-specific metadata
  source_id TEXT, -- FK to strategic_decisions.id, briefings.id, etc.
  source_type TEXT, -- 'strategic_decision' | 'briefing' | 'okr' | 'experiment' | 'manual'
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_product ON memory_nodes(product_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS memory_edges (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL REFERENCES memory_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES memory_nodes(id),
  edge_type TEXT NOT NULL, -- 'caused' | 'informed_by' | 'led_to' | 'contradicts' | 'supports'
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON memory_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges(to_node_id);

CREATE TABLE IF NOT EXISTS decision_counterfactuals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  memory_node_id TEXT NOT NULL REFERENCES memory_nodes(id),
  what_we_decided TEXT NOT NULL,
  what_we_couldve_done TEXT NOT NULL,
  outcome_if_different TEXT, -- filled in retrospectively
  regret_level INTEGER, -- 1-5, filled retrospectively
  noted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_counterfactuals_node ON decision_counterfactuals(memory_node_id);
