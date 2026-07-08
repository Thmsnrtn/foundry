-- =============================================================================
-- FOUNDRY — Schema Hardening for Scale
-- Missing indexes, audit trail, soft deletes, execution queue, usage limits.
-- Required before exceeding 100 customers.
-- =============================================================================

-- ─── Critical Missing Indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_scores_product_verdict ON audit_scores(product_id, verdict);
CREATE INDEX IF NOT EXISTS idx_decisions_product_gate ON decisions(product_id, gate);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_created ON metric_snapshots(created_at);
-- stressor_history's timestamp column is identified_at, not created_at — the
-- original referenced a non-existent column and broke fresh-DB migration.
CREATE INDEX IF NOT EXISTS idx_stressor_history_created ON stressor_history(identified_at);
-- competitive_signals' timestamp column is detected_at, not created_at.
CREATE INDEX IF NOT EXISTS idx_competitive_signals_created ON competitive_signals(detected_at);
CREATE INDEX IF NOT EXISTS idx_cohorts_product_channel ON cohorts(product_id, acquisition_channel);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model ON ai_usage_log(model);
CREATE INDEX IF NOT EXISTS idx_founders_created ON founders(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_founder_read ON notifications(founder_id, read_at);
CREATE INDEX IF NOT EXISTS idx_failure_log_product_category ON failure_log(product_id, category);

-- ─── Audit Trail ────────────────────────────────────────────────────────────
-- Every mutation in the system should be traceable to a person or job.

CREATE TABLE IF NOT EXISTS audit_trail (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values TEXT,
  new_values TEXT,
  changed_by TEXT NOT NULL,
  changed_by_type TEXT NOT NULL CHECK(changed_by_type IN ('founder', 'system', 'job', 'api_key')),
  request_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_table_row ON audit_trail(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created ON audit_trail(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_trail_changed_by ON audit_trail(changed_by);

-- ─── Soft Deletes ───────────────────────────────────────────────────────────
-- Products and decisions should never be permanently deleted; archive instead.

ALTER TABLE products ADD COLUMN deleted_at DATETIME;
ALTER TABLE decisions ADD COLUMN deleted_at DATETIME;
ALTER TABLE competitors ADD COLUMN deleted_at DATETIME;

-- ─── Execution Queue ────────────────────────────────────────────────────────
-- Track background job executions for observability and retry.

CREATE TABLE IF NOT EXISTS execution_queue (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  product_id TEXT,
  founder_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  payload TEXT,
  result TEXT,
  error_log TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exec_queue_status ON execution_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_exec_queue_job ON execution_queue(job_type, status);
CREATE INDEX IF NOT EXISTS idx_exec_queue_product ON execution_queue(product_id);

-- ─── Usage Limits ───────────────────────────────────────────────────────────
-- Enforce per-tier quotas on expensive operations.

CREATE TABLE IF NOT EXISTS usage_limits (
  founder_id TEXT PRIMARY KEY REFERENCES founders(id),
  tier TEXT NOT NULL,
  audit_runs_used INTEGER DEFAULT 0,
  audit_runs_limit INTEGER NOT NULL DEFAULT 10,
  ai_calls_used INTEGER DEFAULT 0,
  ai_calls_limit INTEGER NOT NULL DEFAULT 500,
  api_calls_used INTEGER DEFAULT 0,
  api_calls_limit INTEGER NOT NULL DEFAULT 10000,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Integrations Table ─────────────────────────────────────────────────────
-- Generalized third-party integration credentials (Stripe, GitHub, etc.)

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  provider TEXT NOT NULL CHECK(provider IN ('stripe', 'github', 'slack', 'discord', 'zapier')),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at DATETIME,
  scope TEXT,
  metadata TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_founder ON integrations(founder_id);

-- ─── Onboarding Checklist ───────────────────────────────────────────────────
-- Persistent onboarding progress per founder.

CREATE TABLE IF NOT EXISTS onboarding_checklist (
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  item_key TEXT NOT NULL,
  completed_at DATETIME,
  PRIMARY KEY (founder_id, product_id, item_key)
);
