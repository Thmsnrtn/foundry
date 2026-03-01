-- =============================================================================
-- FOUNDRY — Wisdom Layer + Remediation Engine Schema
-- =============================================================================

-- ─── Product DNA ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_dna (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE REFERENCES products(id),
  icp_description TEXT,
  icp_pain TEXT,
  icp_trigger TEXT,
  icp_sophistication TEXT,
  positioning_statement TEXT,
  positioning_history TEXT,
  what_we_are_not TEXT,
  primary_objection TEXT,
  objection_response TEXT,
  voice_principles TEXT,
  market_insight TEXT,
  retention_hypothesis TEXT,
  growth_hypothesis TEXT,
  sections_completed TEXT DEFAULT '[]',
  completion_pct INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_dna_product ON product_dna(product_id);

-- ─── Failure Log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS failure_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  owner_id TEXT NOT NULL REFERENCES founders(id),
  category TEXT NOT NULL CHECK(category IN (
    'positioning','pricing','onboarding','acquisition',
    'retention','messaging','feature','operations','other'
  )),
  what_was_tried TEXT NOT NULL,
  timeframe TEXT,
  outcome TEXT NOT NULL,
  founder_hypothesis TEXT,
  linked_stressor_id TEXT REFERENCES stressor_history(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_failure_log_product ON failure_log(product_id);
CREATE INDEX IF NOT EXISTS idx_failure_log_category ON failure_log(product_id, category);

-- ─── Founder Judgment Patterns ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS founder_judgment_patterns (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  owner_id TEXT NOT NULL REFERENCES founders(id),
  category TEXT NOT NULL,
  pattern_description TEXT NOT NULL,
  evidence_decision_ids TEXT,
  confidence REAL DEFAULT 0.0,
  times_observed INTEGER DEFAULT 1,
  invalidated BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_judgment_patterns_product ON founder_judgment_patterns(product_id);

-- ─── Remediation PRs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remediation_prs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  owner_id TEXT NOT NULL REFERENCES founders(id),
  audit_score_id TEXT NOT NULL REFERENCES audit_scores(id),
  blocking_issue_id TEXT NOT NULL,
  blocking_issue_dimension TEXT NOT NULL,
  blocking_issue_summary TEXT NOT NULL,
  wisdom_context_pct INTEGER,
  wisdom_patterns_used INTEGER DEFAULT 0,
  wisdom_failures_used INTEGER DEFAULT 0,
  fix_summary TEXT,
  fix_approach TEXT,
  files_modified TEXT,
  github_branch TEXT,
  github_pr_number INTEGER,
  github_pr_url TEXT,
  github_base_branch TEXT DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'generating' CHECK(status IN (
    'generating','pr_open','merged','rejected','failed','skipped'
  )),
  skipped_reason TEXT,
  rejection_reason TEXT,
  failure_reason TEXT,
  pre_fix_dimension_score INTEGER,
  post_fix_dimension_score INTEGER,
  re_audit_triggered_at DATETIME,
  re_audit_completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_remediation_prs_product ON remediation_prs(product_id);
CREATE INDEX IF NOT EXISTS idx_remediation_prs_status ON remediation_prs(status);
CREATE INDEX IF NOT EXISTS idx_remediation_prs_audit ON remediation_prs(audit_score_id);

-- ─── ALTER existing tables ───────────────────────────────────────────────────
-- SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so we handle errors in app code.
-- These columns are added idempotently via the migration runner.

ALTER TABLE decisions ADD COLUMN resolution_reasoning TEXT;

ALTER TABLE decisions ADD COLUMN wisdom_context_used TEXT;

ALTER TABLE lifecycle_state ADD COLUMN dna_completion_pct INTEGER DEFAULT 0;

ALTER TABLE lifecycle_state ADD COLUMN wisdom_layer_active BOOLEAN DEFAULT FALSE;
