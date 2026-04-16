-- Migration 049: Cohort Intelligence — collective pattern recognition across the network
-- Anonymized aggregate patterns, failure pattern library, and per-product pattern matching.

-- Cohort patterns computed from aggregate data (anonymized)
CREATE TABLE IF NOT EXISTS cohort_patterns (
  id TEXT PRIMARY KEY,
  cohort_key TEXT NOT NULL, -- e.g. 'b2b_saas_seed_10k_mrr'
  cohort_definition_json TEXT NOT NULL, -- JSON: what defines this cohort
  pattern_type TEXT NOT NULL, -- 'growth_trajectory' | 'churn_inflection' | 'fundraising_window' | 'team_scaling'
  pattern_name TEXT NOT NULL,
  pattern_description TEXT NOT NULL,
  supporting_data_json TEXT, -- anonymized aggregate stats
  confidence REAL NOT NULL DEFAULT 0.5,
  company_count INTEGER NOT NULL DEFAULT 0, -- how many companies informed this
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cohort_patterns_key ON cohort_patterns(cohort_key, pattern_type);

-- Failure pattern library — what precedes bad outcomes
CREATE TABLE IF NOT EXISTS failure_patterns (
  id TEXT PRIMARY KEY,
  pattern_name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL, -- 'churn_spike' | 'runway_crisis' | 'growth_stall' | 'team_fracture' | 'product_drift'
  warning_signals_json TEXT NOT NULL, -- JSON array of early warning signals
  typical_lead_time_days INTEGER, -- how many days before failure these signals appear
  mitigation_actions_json TEXT NOT NULL, -- JSON array of what worked
  match_criteria_json TEXT NOT NULL, -- JSON: how to check if a company matches this pattern
  severity TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'critical'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Track which patterns have been matched for which products
CREATE TABLE IF NOT EXISTS pattern_matches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  failure_pattern_id TEXT NOT NULL REFERENCES failure_patterns(id),
  match_score REAL NOT NULL, -- 0-1 how closely the company matches the pattern
  matched_signals_json TEXT NOT NULL,
  first_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT, -- null if still active
  outcome TEXT -- 'avoided' | 'occurred' | 'monitoring'
);
CREATE INDEX IF NOT EXISTS idx_pattern_matches_product ON pattern_matches(product_id, first_detected_at DESC);
