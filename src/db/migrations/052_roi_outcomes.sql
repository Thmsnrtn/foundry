-- Every recommendation the system makes, tracked for outcomes
CREATE TABLE IF NOT EXISTS recommendation_outcomes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  recommendation_text TEXT NOT NULL,
  recommendation_date TEXT NOT NULL DEFAULT (date('now')),
  action_taken INTEGER NOT NULL DEFAULT 0,    -- 0=ignored, 1=acted_on
  action_taken_at TEXT,
  action_taken_days_after INTEGER,            -- how many days after recommendation
  outcome TEXT,                               -- 'positive' | 'neutral' | 'negative' | 'unknown'
  outcome_notes TEXT,
  outcome_measured_at TEXT,
  estimated_value_dollars REAL,               -- dollar value of the recommendation outcome
  category TEXT NOT NULL DEFAULT 'other',     -- 'churn_prevented' | 'expansion_captured' | 'cost_avoided' | 'revenue_accelerated' | 'risk_mitigated' | 'time_saved'
  source_session_id TEXT,                     -- links to agent_sessions
  source_action_execution_id TEXT             -- links to action_executions if actioned through platform
);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_product ON recommendation_outcomes(product_id, recommendation_date DESC);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_agent ON recommendation_outcomes(product_id, agent_name, outcome);

-- Monthly ROI summaries (computed and cached)
CREATE TABLE IF NOT EXISTS roi_monthly_summaries (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  month TEXT NOT NULL,                        -- 'YYYY-MM'
  -- Value delivered
  churn_prevented_dollars REAL NOT NULL DEFAULT 0,
  expansion_captured_dollars REAL NOT NULL DEFAULT 0,
  cost_avoided_dollars REAL NOT NULL DEFAULT 0,
  time_saved_hours REAL NOT NULL DEFAULT 0,
  time_saved_dollars REAL NOT NULL DEFAULT 0,
  total_value_dollars REAL NOT NULL DEFAULT 0,
  -- Activity
  recommendations_made INTEGER NOT NULL DEFAULT 0,
  recommendations_acted_on INTEGER NOT NULL DEFAULT 0,
  action_rate_pct REAL NOT NULL DEFAULT 0,
  -- Accuracy
  positive_outcomes INTEGER NOT NULL DEFAULT 0,
  negative_outcomes INTEGER NOT NULL DEFAULT 0,
  outcome_rate_pct REAL NOT NULL DEFAULT 0,
  -- Platform cost (for ROI ratio)
  platform_cost_dollars REAL,
  roi_multiple REAL,                          -- total_value / platform_cost
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roi_monthly_product ON roi_monthly_summaries(product_id, month);
