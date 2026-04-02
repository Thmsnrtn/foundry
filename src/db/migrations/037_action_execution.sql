-- Action templates: reusable blueprints for common agent actions
CREATE TABLE IF NOT EXISTS action_templates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'send_email' | 'create_ticket' | 'post_slack' | 'schedule_call' | 'update_crm' | 'custom_webhook'
  integration TEXT NOT NULL, -- which integration handles execution
  template_json TEXT NOT NULL DEFAULT '{}', -- JSON: { subject?, body_template?, channel?, fields? }
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_action_templates_product ON action_templates(product_id, action_type);

-- Action executions: track what was actually executed
CREATE TABLE IF NOT EXISTS action_executions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  outbound_action_id TEXT REFERENCES outbound_actions(id),
  template_id TEXT REFERENCES action_templates(id),
  action_type TEXT NOT NULL,
  integration TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', -- what was sent
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','executing','completed','failed','cancelled')),
  approved_by TEXT, -- user id
  approved_at TEXT,
  executed_at TEXT,
  result_json TEXT, -- response from integration
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_action_executions_product ON action_executions(product_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_action_executions_action ON action_executions(outbound_action_id);
