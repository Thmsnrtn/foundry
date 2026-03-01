-- =============================================================================
-- FOUNDRY — Complete Database Schema
-- All 16 tables. Multi-tenant. Every query scopes by owner_id.
-- Exception: decision_patterns is intentionally cross-product and anonymized.
-- =============================================================================

-- ─── Founders ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS founders (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,
  tier TEXT CHECK(tier IN ('founding_cohort', 'growth', 'scale')),
  cohort_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  preferences TEXT -- JSON: digest time, notification channels
);

CREATE INDEX IF NOT EXISTS idx_founders_clerk ON founders(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_founders_email ON founders(email);
CREATE INDEX IF NOT EXISTS idx_founders_tier ON founders(tier);

-- ─── Products ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES founders(id),
  github_repo_url TEXT,
  github_repo_owner TEXT,
  github_repo_name TEXT,
  github_access_token TEXT, -- Encrypted
  stack_description TEXT,
  market_category TEXT, -- SaaS subcategory for cross-product pattern matching
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_products_owner ON products(owner_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_market_category ON products(market_category);

-- ─── Lifecycle State ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle_state (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  current_prompt TEXT NOT NULL DEFAULT 'prompt_1',
  risk_state TEXT NOT NULL DEFAULT 'green' CHECK(risk_state IN ('green', 'yellow', 'red')),
  risk_state_changed_at DATETIME,
  risk_state_reason TEXT,
  prompt_1_status TEXT DEFAULT 'not_started',
  prompt_1_completed_at DATETIME,
  prompt_1_verdict TEXT,
  prompt_1_composite REAL,
  prompt_2_status TEXT DEFAULT 'not_started',
  prompt_2_completed_at DATETIME,
  prompt_2_hypotheses TEXT, -- JSON: {h1: confirmed|failed|pending, ...}
  prompt_2_5_status TEXT DEFAULT 'not_started',
  prompt_2_5_tier INTEGER DEFAULT 0, -- 0=not started, 1, 2, 3
  prompt_3_status TEXT DEFAULT 'not_started',
  prompt_3_completed_at DATETIME,
  prompt_4_status TEXT DEFAULT 'not_started',
  prompt_4_completed_at DATETIME,
  prompt_5_status TEXT DEFAULT 'dormant',
  prompt_5_last_run DATETIME,
  prompt_6_status TEXT DEFAULT 'dormant',
  prompt_7_status TEXT DEFAULT 'dormant',
  prompt_8_status TEXT DEFAULT 'dormant',
  prompt_9_status TEXT DEFAULT 'dormant',
  prompt_9_started_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_risk ON lifecycle_state(risk_state);

-- ─── Audit Scores ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  run_type TEXT CHECK(run_type IN ('initial', 'post_remediation', 'periodic')),
  d1_score INTEGER,
  d2_score INTEGER,
  d3_score INTEGER,
  d4_score INTEGER,
  d5_score INTEGER,
  d6_score INTEGER,
  d7_score INTEGER,
  d8_score INTEGER,
  d9_score INTEGER,
  d10_score INTEGER,
  composite REAL,
  verdict TEXT,
  findings TEXT, -- JSON: array of finding objects
  blocking_issues TEXT, -- JSON: array of BLOCK objects
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_product ON audit_scores(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_product_date ON audit_scores(product_id, created_at);

-- ─── Decisions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  category TEXT CHECK(category IN ('urgent', 'strategic', 'product', 'marketing', 'informational')),
  gate INTEGER CHECK(gate BETWEEN 0 AND 4),
  what TEXT NOT NULL,
  why_now TEXT NOT NULL,
  context TEXT, -- JSON: array of data points
  options TEXT, -- JSON: array of {label, description, trade_offs}
  recommendation TEXT,
  impact TEXT,
  scenario_model TEXT, -- JSON: for Gate 3 decisions
  deadline DATETIME,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'executed', 'expired')),
  chosen_option TEXT,
  outcome TEXT,
  outcome_measured_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME,
  decided_by TEXT -- founder, system_gate_0, system_gate_1
);

CREATE INDEX IF NOT EXISTS idx_decisions_product ON decisions(product_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
CREATE INDEX IF NOT EXISTS idx_decisions_product_status ON decisions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_gate ON decisions(gate);

-- ─── Audit Log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  action_type TEXT NOT NULL,
  gate INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  input_context TEXT, -- JSON
  output TEXT, -- JSON
  outcome TEXT,
  confidence_score REAL,
  risk_state_at_action TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_audit_log_product ON audit_log(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_gate ON audit_log(gate);
CREATE INDEX IF NOT EXISTS idx_audit_log_product_date ON audit_log(product_id, created_at);

-- ─── Beta Intake ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beta_intake (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  participant_name TEXT,
  interview_summary TEXT,
  key_quotes TEXT, -- JSON: array of {quote, theme}
  activation_outcome TEXT, -- JSON
  testimonial_text TEXT,
  testimonial_permitted BOOLEAN DEFAULT FALSE,
  positioning_feedback TEXT,
  hypothesis_signals TEXT, -- JSON: {h1: data, h2: data, ...}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_beta_intake_product ON beta_intake(product_id);
CREATE INDEX IF NOT EXISTS idx_beta_intake_processed ON beta_intake(product_id, processed);

-- ─── Lifecycle Conditions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle_conditions (
  product_id TEXT NOT NULL REFERENCES products(id),
  prompt TEXT NOT NULL,
  condition_name TEXT NOT NULL,
  condition_met BOOLEAN DEFAULT FALSE,
  current_value TEXT,
  threshold_value TEXT,
  last_checked DATETIME,
  PRIMARY KEY (product_id, prompt, condition_name)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_cond_product ON lifecycle_conditions(product_id);

-- ─── Founding Story Artifacts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS founding_story_artifacts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  phase TEXT NOT NULL,
  artifact_type TEXT CHECK(artifact_type IN ('audit', 'remediation', 'beta_outcome', 'lifecycle_activation', 'risk_event', 'ecosystem_connection', 'recovery', 'milestone')),
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- JSON or Markdown
  evidence_links TEXT, -- JSON: array of URLs or file paths
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_story_product ON founding_story_artifacts(product_id);
CREATE INDEX IF NOT EXISTS idx_story_published ON founding_story_artifacts(published);

-- ─── Metric Snapshots ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  snapshot_date DATE NOT NULL,
  signups_7d INTEGER,
  active_users INTEGER,
  new_mrr_cents INTEGER DEFAULT 0,
  expansion_mrr_cents INTEGER DEFAULT 0,
  contraction_mrr_cents INTEGER DEFAULT 0,
  churned_mrr_cents INTEGER DEFAULT 0,
  activation_rate REAL,
  day_30_retention REAL,
  support_volume_7d INTEGER,
  nps_score REAL,
  churn_rate REAL,
  mrr_health_ratio REAL, -- churned_mrr_cents / new_mrr_cents; null if new is 0
  custom_metrics TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_product ON metric_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_metrics_product_date ON metric_snapshots(product_id, snapshot_date);

-- ─── Stressor History ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stressor_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  stressor_name TEXT NOT NULL,
  signal TEXT NOT NULL,
  timeframe_days INTEGER NOT NULL,
  neutralizing_action TEXT NOT NULL,
  severity TEXT CHECK(severity IN ('watch', 'elevated', 'critical')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'resolved', 'escalated')),
  identified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolution_notes TEXT,
  risk_state_at_identification TEXT
);

CREATE INDEX IF NOT EXISTS idx_stressor_product ON stressor_history(product_id);
CREATE INDEX IF NOT EXISTS idx_stressor_status ON stressor_history(status);
CREATE INDEX IF NOT EXISTS idx_stressor_product_active ON stressor_history(product_id, status);

-- ─── Scenario Models ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scenario_models (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  option_label TEXT NOT NULL,
  best_case TEXT NOT NULL, -- JSON
  base_case TEXT NOT NULL, -- JSON
  stress_case TEXT NOT NULL, -- JSON
  data_inputs_used TEXT NOT NULL, -- JSON
  patterns_referenced TEXT, -- JSON: which decision_patterns records were used
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  outcome_accuracy TEXT -- JSON: post-decision comparison
);

CREATE INDEX IF NOT EXISTS idx_scenario_decision ON scenario_models(decision_id);
CREATE INDEX IF NOT EXISTS idx_scenario_product ON scenario_models(product_id);

-- ─── Decision Patterns (Cross-Product, Anonymized) ───────────────────────────
-- This table is intentionally NOT scoped by founder or product.
-- No founder-identifiable or product-identifiable data exists here.
CREATE TABLE IF NOT EXISTS decision_patterns (
  id TEXT PRIMARY KEY,
  decision_type TEXT NOT NULL,
  product_lifecycle_stage TEXT NOT NULL,
  risk_state_at_decision TEXT NOT NULL,
  key_metrics_context TEXT NOT NULL, -- JSON: anonymized metric ranges
  option_chosen_category TEXT NOT NULL,
  outcome_direction TEXT CHECK(outcome_direction IN ('positive', 'neutral', 'negative')),
  outcome_magnitude TEXT CHECK(outcome_magnitude IN ('significant', 'moderate', 'minimal')),
  outcome_timeframe_days INTEGER,
  market_category TEXT,
  contributing_factors TEXT, -- JSON
  scenario_accuracy_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON decision_patterns(decision_type);
CREATE INDEX IF NOT EXISTS idx_patterns_stage ON decision_patterns(product_lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_patterns_risk ON decision_patterns(risk_state_at_decision);
CREATE INDEX IF NOT EXISTS idx_patterns_market ON decision_patterns(market_category);

-- ─── Cohorts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  acquisition_period DATE NOT NULL,
  acquisition_channel TEXT,
  acquisition_source TEXT,
  founder_count INTEGER DEFAULT 0,
  activated_count INTEGER DEFAULT 0,
  retained_day_7 INTEGER DEFAULT 0,
  retained_day_14 INTEGER DEFAULT 0,
  retained_day_30 INTEGER DEFAULT 0,
  retained_day_60 INTEGER DEFAULT 0,
  retained_day_90 INTEGER DEFAULT 0,
  converted_to_paid INTEGER DEFAULT 0,
  churned_count INTEGER DEFAULT 0,
  avg_activation_minutes REAL,
  mrr_contribution_cents INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, acquisition_period, acquisition_channel)
);

CREATE INDEX IF NOT EXISTS idx_cohorts_product ON cohorts(product_id);
CREATE INDEX IF NOT EXISTS idx_cohorts_channel ON cohorts(acquisition_channel);

-- ─── Competitors ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  website TEXT,
  positioning TEXT,
  primary_icp TEXT,
  pricing_model TEXT,
  known_weaknesses TEXT,
  monitoring_active BOOLEAN DEFAULT TRUE,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_checked DATETIME
);

CREATE INDEX IF NOT EXISTS idx_competitors_product ON competitors(product_id);
CREATE INDEX IF NOT EXISTS idx_competitors_active ON competitors(product_id, monitoring_active);

-- ─── Competitive Signals ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitive_signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  competitor_name TEXT NOT NULL,
  signal_type TEXT CHECK(signal_type IN ('pricing_change', 'feature_launch', 'positioning_shift', 'new_entrant', 'market_exit', 'funding', 'acquisition')),
  signal_summary TEXT NOT NULL,
  signal_detail TEXT, -- JSON
  significance TEXT CHECK(significance IN ('low', 'medium', 'high')),
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed BOOLEAN DEFAULT FALSE,
  linked_stressor_id TEXT REFERENCES stressor_history(id)
);

CREATE INDEX IF NOT EXISTS idx_comp_signals_product ON competitive_signals(product_id);
CREATE INDEX IF NOT EXISTS idx_comp_signals_significance ON competitive_signals(significance);
CREATE INDEX IF NOT EXISTS idx_comp_signals_product_date ON competitive_signals(product_id, detected_at);
