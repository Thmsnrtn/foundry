-- =============================================================================
-- Migration 022: Action Execution Engine
-- Draft artifacts for decisions, auto-execution for Gate 0.
-- =============================================================================

CREATE TABLE IF NOT EXISTS action_drafts (
  id TEXT PRIMARY KEY,
  decision_id TEXT REFERENCES decisions(id),
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  draft_content TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  metadata TEXT,
  gate INTEGER NOT NULL,
  auto_executable INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  approved_at TEXT,
  executed_at TEXT,
  execution_result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auto_execution_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  action_draft_id TEXT REFERENCES action_drafts(id),
  action_type TEXT NOT NULL,
  trigger TEXT NOT NULL,
  input_context TEXT,
  output TEXT,
  success INTEGER,
  error TEXT,
  executed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_drafts_decision ON action_drafts(decision_id);
CREATE INDEX IF NOT EXISTS idx_action_drafts_product ON action_drafts(product_id, status);
CREATE INDEX IF NOT EXISTS idx_auto_exec_product ON auto_execution_log(product_id);
