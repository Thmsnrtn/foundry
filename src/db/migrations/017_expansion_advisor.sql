-- =============================================================================
-- Migration 017: Autonomous Market Expansion Advisor
-- TAM estimation, saturation projection, expansion opportunity identification.
-- =============================================================================

CREATE TABLE IF NOT EXISTS expansion_analysis (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  current_tam_estimate REAL,
  tam_penetration_rate REAL,
  years_to_saturation REAL,
  expansion_opportunities TEXT,
  depth_vs_breadth_recommendation TEXT,
  strategic_fork_scenarios TEXT,
  analyzed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expansion_product ON expansion_analysis(product_id);
