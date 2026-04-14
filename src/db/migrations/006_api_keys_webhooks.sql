-- =============================================================================
-- FOUNDRY — API Keys & Webhooks
-- Public API key management and customer webhook system.
-- =============================================================================

-- API Keys for public REST API
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  revoked_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_api_keys_founder ON api_keys(founder_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Customer Webhook Endpoints
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  url TEXT NOT NULL,
  events TEXT NOT NULL, -- JSON array of event types
  secret TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  failure_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_delivery_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_webhooks_founder ON webhooks(founder_id);

-- Webhook Delivery Log
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id),
  event TEXT NOT NULL,
  status_code INTEGER,
  delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
