-- forecast_scenarios: saved runway/growth scenarios
CREATE TABLE IF NOT EXISTS forecast_scenarios (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL, -- e.g. 'Base Case', 'Bear Case - Hire 2 Engineers'
  scenario_type TEXT NOT NULL CHECK (scenario_type IN ('runway','growth','hiring','pricing','churn')),
  assumptions_json TEXT NOT NULL DEFAULT '{}',
  -- assumptions: { monthly_burn_delta_usd, mrr_growth_rate_pct, churn_rate_override, headcount_additions, ... }
  results_json TEXT NOT NULL DEFAULT '{}',
  -- results: { runway_months, probability_series_a, target_hit_probability, ... }
  generated_by TEXT NOT NULL DEFAULT 'system', -- 'system' | 'founder' | 'prism'
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scenarios_product ON forecast_scenarios(product_id, scenario_type, created_at);

-- forecast_checkpoints: track actual vs predicted over time
CREATE TABLE IF NOT EXISTS forecast_checkpoints (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  scenario_id TEXT REFERENCES forecast_scenarios(id),
  checkpoint_date TEXT NOT NULL,
  predicted_value REAL NOT NULL,
  actual_value REAL,
  metric_name TEXT NOT NULL, -- 'mrr', 'runway_months', 'churn_rate', etc.
  variance_pct REAL, -- populated when actual_value is recorded
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_product ON forecast_checkpoints(product_id, metric_name, checkpoint_date);
