-- agent_predictions: specific, measurable predictions made by agents
CREATE TABLE IF NOT EXISTS agent_predictions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  -- Types: 'churn_risk' | 'expansion_opportunity' | 'metric_target' | 'experiment_outcome' | 'risk_escalation'
  prediction_text TEXT NOT NULL, -- human-readable: "Customer Acme Corp will churn within 30 days"
  predicted_value REAL, -- numeric prediction if applicable (e.g. probability 0.0-1.0)
  confidence REAL NOT NULL, -- 0.0-1.0, agent's stated confidence
  measure_by_date TEXT NOT NULL, -- when to check the outcome (ISO date)
  outcome_criteria TEXT NOT NULL, -- what to check: "customer_id=X AND stage='churned'"
  -- Outcome fields (populated when measured)
  outcome TEXT CHECK (outcome IN ('correct','incorrect','partial','unmeasurable')),
  outcome_measured_at TEXT,
  outcome_notes TEXT,
  accuracy_score REAL, -- 0.0-1.0: correct=1.0, partial=0.5, incorrect=0.0
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_predictions_product ON agent_predictions(product_id, agent_name, measure_by_date);
CREATE INDEX IF NOT EXISTS idx_predictions_pending ON agent_predictions(measure_by_date, outcome) WHERE outcome IS NULL;

-- agent_accuracy_scores: rolling accuracy metrics per agent
CREATE TABLE IF NOT EXISTS agent_accuracy_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  period_start TEXT NOT NULL, -- ISO date, start of 30-day window
  total_predictions INTEGER NOT NULL DEFAULT 0,
  measured_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  accuracy_rate REAL, -- correct / measured
  avg_confidence REAL, -- average stated confidence
  calibration_score REAL, -- how well confidence matches accuracy (Brier score style)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, agent_name, prediction_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_accuracy_scores_product ON agent_accuracy_scores(product_id, agent_name);
