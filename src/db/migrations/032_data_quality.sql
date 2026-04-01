-- Migration 032: Metric validation and data quality
-- Provides a rule-based validation layer for incoming metric snapshots.
-- Agents use these rules to detect anomalies, gaps, and contradictions
-- before metrics are stored or acted upon.

-- metric_validation_rules: defines acceptable bounds and change limits per metric
-- rule_type drives which validation logic applies:
--   range           — value must be between rule_params.min and rule_params.max
--   non_negative    — value must be >= 0
--   max_value       — value must be <= rule_params.max
--   min_value       — value must be >= rule_params.min
--   no_sudden_drop  — value must not decrease by more than rule_params.max_pct_change %
--   no_sudden_spike — value must not increase by more than rule_params.max_pct_change %
CREATE TABLE IF NOT EXISTS metric_validation_rules (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL,
  metric_name  TEXT NOT NULL,   -- e.g. 'churn_rate', 'activation_rate', 'mrr_cents'
  rule_type    TEXT NOT NULL CHECK (rule_type IN (
                 'range','non_negative','max_value','min_value',
                 'no_sudden_drop','no_sudden_spike'
               )),
  rule_params  TEXT NOT NULL DEFAULT '{}',  -- JSON: { min, max, max_pct_change, ... }
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metric_rules_product
  ON metric_validation_rules(product_id, metric_name);

-- data_quality_alerts: raised when a rule fires or a data problem is detected
-- alert_type distinguishes why the alert was raised:
--   validation_failed   — a metric_validation_rules rule was violated
--   data_gap            — expected data did not arrive within the expected window
--   conflicting_sources — two sources report materially different values for the same metric
--   stale_data          — a metric has not been updated within its expected refresh interval
-- resolved_at is NULL while the alert is open; set when the issue is acknowledged or auto-cleared
CREATE TABLE IF NOT EXISTS data_quality_alerts (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL,
  rule_id        TEXT REFERENCES metric_validation_rules(id),  -- NULL for non-rule alerts
  alert_type     TEXT NOT NULL CHECK (alert_type IN (
                   'validation_failed','data_gap','conflicting_sources','stale_data'
                 )),
  metric_name    TEXT,
  expected_value TEXT,   -- stored as TEXT to accommodate any scalar type
  actual_value   TEXT,
  description    TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
  resolved_at    TEXT,   -- NULL = still open
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dq_alerts_product
  ON data_quality_alerts(product_id, resolved_at, created_at);

CREATE INDEX IF NOT EXISTS idx_dq_alerts_open
  ON data_quality_alerts(product_id, severity)
  WHERE resolved_at IS NULL;
