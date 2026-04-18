-- =============================================================================
-- Migration 023: Predictive Intelligence Engine
-- Leading indicators, pre-stressor detection, probability forecasts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  description TEXT NOT NULL,
  probability REAL NOT NULL,
  time_horizon_days INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  recommended_action TEXT,
  pattern_sources TEXT,
  status TEXT DEFAULT 'active',
  outcome TEXT,
  outcome_recorded_at TEXT,
  accuracy_score REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leading_indicators (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  growth_stage TEXT NOT NULL,
  indicator_name TEXT NOT NULL,
  indicator_description TEXT NOT NULL,
  predicts TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL,
  confidence REAL,
  sample_size INTEGER,
  formula TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_predictions_product ON predictions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON predictions(prediction_type);
CREATE INDEX IF NOT EXISTS idx_leading_sector ON leading_indicators(sector, growth_stage);
