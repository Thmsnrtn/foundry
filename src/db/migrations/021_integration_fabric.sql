-- Integration connections per company
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(name IN ('stripe','posthog','plausible','resend','github','sentry','linear')),
  type TEXT NOT NULL CHECK(type IN ('inbound','outbound','bidirectional')),
  status TEXT NOT NULL DEFAULT 'pending_auth' CHECK(status IN ('active','paused','errored','pending_auth','disconnected')),
  -- Credentials stored as JSON, encrypted at app layer
  credentials_json TEXT,
  -- Integration-specific configuration
  config_json TEXT DEFAULT '{}',
  authorized_agents TEXT DEFAULT '["all"]',  -- JSON: agent names or ["all"]
  last_synced_at DATETIME,
  last_error TEXT,
  total_inbound_events INTEGER DEFAULT 0,
  total_outbound_actions INTEGER DEFAULT 0,
  error_count_trailing_7d INTEGER DEFAULT 0,
  cost_trailing_30d_usd REAL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, name)
);

-- Normalized events from all integrations
CREATE TABLE IF NOT EXISTS integration_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  integration_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT DEFAULT 'system',
  actor_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  relevance_scores TEXT DEFAULT '{}',  -- JSON: {agent_name: 0-1}
  processed_by TEXT DEFAULT '[]',      -- JSON: agent names that processed this
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Outbound actions agents can take via integrations
CREATE TABLE IF NOT EXISTS outbound_actions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  integration_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  authority_level INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN (
    'pending_approval','approved','executing','executed','failed','rejected','cancelled'
  )),
  parameters_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  preview_text TEXT,          -- Human-readable preview for CEO approval UI
  rationale TEXT NOT NULL,    -- Why the agent proposes this action
  confidence REAL DEFAULT 0.8,
  approved_by TEXT,           -- 'auto' or 'ceo'
  approved_at DATETIME,
  executed_at DATETIME,
  feedback_status TEXT DEFAULT 'pending' CHECK(feedback_status IN ('pending','positive','negative','neutral','not_applicable')),
  feedback_data_json TEXT,    -- Open rates, conversions, etc.
  cost_usd REAL DEFAULT 0.0,
  expires_at DATETIME,        -- Actions become stale after this
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-agent rate limits for outbound actions
CREATE TABLE IF NOT EXISTS outbound_rate_limits (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  integration_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  max_per_hour INTEGER DEFAULT 10,
  max_per_day INTEGER DEFAULT 50,
  current_hour_count INTEGER DEFAULT 0,
  current_day_count INTEGER DEFAULT 0,
  hour_reset_at DATETIME,
  day_reset_at DATETIME,
  UNIQUE(product_id, agent_name, integration_name, action_type)
);

CREATE INDEX IF NOT EXISTS idx_integrations_product ON integrations(product_id);
CREATE INDEX IF NOT EXISTS idx_integration_events_product ON integration_events(product_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_events_unprocessed ON integration_events(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_actions_product ON outbound_actions(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_actions_pending ON outbound_actions(product_id, status) WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_outbound_rate_limits ON outbound_rate_limits(product_id, agent_name);
