-- ============================================================
-- FOUNDRY — Migration 018: Wisdom Layer + Intelligence Network
-- ============================================================

-- Decision Outcomes: tracks the result of approved/denied decisions
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  session_id TEXT,
  decision_title TEXT NOT NULL,
  decision_description TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('approved', 'denied')),
  outcome_result TEXT CHECK(outcome_result IN ('positive', 'negative', 'neutral', 'pending')),
  founder_rationale TEXT,
  impact_usd REAL,
  context_json TEXT,       -- JSON: the full AgentDecision object
  resolved_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_product ON decision_outcomes(product_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_agent ON decision_outcomes(product_id, agent_name);

-- Wisdom Patterns: synthesized behavioral patterns from decision outcomes
CREATE TABLE IF NOT EXISTS wisdom_patterns (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,  -- 'what_works', 'what_fails', 'agent_tendency', 'approval_signal'
  agent_name TEXT,             -- NULL means cross-agent pattern
  pattern TEXT NOT NULL,       -- The synthesized wisdom statement
  evidence_count INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  supporting_decision_ids TEXT,  -- JSON array of decision_outcome IDs
  active INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wisdom_patterns_product ON wisdom_patterns(product_id, active);
CREATE INDEX IF NOT EXISTS idx_wisdom_patterns_agent ON wisdom_patterns(product_id, agent_name);

-- Intelligence Benchmarks: anonymized cross-product benchmarks (computed by system)
CREATE TABLE IF NOT EXISTS intelligence_benchmarks (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,   -- e.g., 'health_score', 'approval_rate', 'evolution_cycles_per_month'
  cohort TEXT NOT NULL DEFAULT 'all',  -- 'all', 'early_stage', 'growth', 'scale'
  p25 REAL,
  p50 REAL,
  p75 REAL,
  p90 REAL,
  cohort_size INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmarks_metric_cohort ON intelligence_benchmarks(metric_name, cohort);
