CREATE TABLE IF NOT EXISTS execution_playbooks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL, -- 'metric_threshold' | 'agent_signal' | 'schedule' | 'manual'
  trigger_config_json TEXT NOT NULL, -- JSON: conditions to evaluate
  action_type TEXT NOT NULL, -- 'post_slack' | 'create_ticket' | 'send_email' | 'custom_webhook'
  action_config_json TEXT NOT NULL, -- JSON: action payload template
  auto_execute INTEGER NOT NULL DEFAULT 0, -- 0=require approval, 1=auto-execute
  execution_budget_weekly INTEGER, -- max executions per week (null = unlimited)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_evaluated_at TEXT,
  last_triggered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_exec_playbooks_product ON execution_playbooks(product_id, is_active);

CREATE TABLE IF NOT EXISTS playbook_trigger_log (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL REFERENCES execution_playbooks(id),
  product_id TEXT NOT NULL,
  evaluation_result TEXT NOT NULL, -- 'triggered' | 'skipped' | 'budget_exceeded'
  condition_snapshot_json TEXT, -- what the condition values were at evaluation time
  action_execution_id TEXT, -- FK to action_executions if one was created
  triggered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trigger_log_playbook ON playbook_trigger_log(playbook_id, triggered_at DESC);
