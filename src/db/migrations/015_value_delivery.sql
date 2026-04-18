-- =============================================================================
-- Migration 015: Value Delivery Index
-- Measures how effectively the product delivers value to users.
-- =============================================================================

CREATE TABLE IF NOT EXISTS value_delivery_metrics (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  core_workflow_completion_rate REAL,
  feature_utilization_breadth REAL,
  time_to_first_value_hours REAL,
  outcome_achievement_rate REAL,
  engagement_depth_score REAL,
  value_delivery_index REAL,
  nps_score REAL,
  support_ticket_rate REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vdm_product ON value_delivery_metrics(product_id);
CREATE INDEX IF NOT EXISTS idx_vdm_product_date ON value_delivery_metrics(product_id, snapshot_date);
