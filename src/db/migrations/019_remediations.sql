-- FOUNDRY — Migration 019: Agent Remediations
-- Trackable remediation items created by SCP agents.

CREATE TABLE IF NOT EXISTS agent_remediations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  session_id TEXT,
  remediation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  estimated_effort TEXT,
  affected_area TEXT,
  suggested_fix TEXT,
  github_issue_url TEXT,
  resolved_at TEXT,
  dismissed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_remediations_product ON agent_remediations(product_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_remediations_agent ON agent_remediations(product_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_remediations_severity ON agent_remediations(product_id, severity, status);
