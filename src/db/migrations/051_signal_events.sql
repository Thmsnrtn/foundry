CREATE TABLE IF NOT EXISTS signal_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,       -- 'stripe' | 'intercom' | 'linear' | 'slack' | 'fathom' | 'manual' | 'agent'
  event_type TEXT NOT NULL,   -- 'churn_detected' | 'expansion_signal' | 'nps_drop' | 'activation_failure' | 'revenue_milestone' | 'competitor_signal' | 'support_spike' | 'payment_failed'
  severity TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'critical'
  payload_json TEXT NOT NULL, -- the raw event data
  summary TEXT NOT NULL,      -- 1-sentence human-readable summary
  relevant_agents_json TEXT,  -- JSON array of AgentName strings that should process this
  processed INTEGER NOT NULL DEFAULT 0,
  processing_session_id TEXT, -- links to agent_sessions if triggered an agent run
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_signal_events_product ON signal_events(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_events_unprocessed ON signal_events(product_id, processed) WHERE processed = 0;

CREATE TABLE IF NOT EXISTS integration_health (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  integration_source TEXT NOT NULL,  -- 'stripe' | 'intercom' | 'linear' | 'slack' | 'github'
  last_event_at TEXT,
  last_successful_sync TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'unknown', -- 'healthy' | 'degraded' | 'stale' | 'error' | 'unknown'
  data_freshness_hours REAL,  -- how old is the most recent data
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_health_key ON integration_health(product_id, integration_source);
