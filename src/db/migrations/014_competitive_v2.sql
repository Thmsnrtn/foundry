-- =============================================================================
-- Migration 014: Competitive Intelligence 2.0
-- Platform dependency, incumbent response, moat erosion, switching costs.
-- =============================================================================

ALTER TABLE competitors ADD COLUMN platform_dependency_risk REAL;

ALTER TABLE competitors ADD COLUMN incumbent_response_probability REAL;

ALTER TABLE competitors ADD COLUMN moat_erosion_rate REAL;

CREATE TABLE IF NOT EXISTS switching_cost_analysis (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  cost_to_leave_us REAL,
  cost_to_leave_incumbent REAL,
  switching_cost_ratio REAL,
  data_portability_score REAL,
  integration_depth_score REAL,
  analyzed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_switching_product ON switching_cost_analysis(product_id);
