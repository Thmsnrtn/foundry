-- =============================================================================
-- Migration 026: Financial Scenario Simulator
-- What-if modeling, runway projection, break-even analysis.
-- =============================================================================

CREATE TABLE IF NOT EXISTS financial_scenarios (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  inputs TEXT NOT NULL,
  projections TEXT NOT NULL,
  assumptions TEXT,
  recommendations TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runway_models (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  monthly_burn REAL,
  monthly_revenue REAL,
  cash_on_hand REAL,
  runway_months REAL,
  break_even_date TEXT,
  break_even_mrr REAL,
  personal_runway_months REAL,
  gap_months REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fin_scenarios_product ON financial_scenarios(product_id);
CREATE INDEX IF NOT EXISTS idx_runway_founder ON runway_models(founder_id);
