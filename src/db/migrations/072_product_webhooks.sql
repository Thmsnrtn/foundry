-- =============================================================================
-- FOUNDRY — Per-Product Outbound Webhooks (Wave 3, action 23)
-- Configures Foundry to POST events (decision_needed, signal_tier_shift,
-- briefing_ready, agent_action_executed) to Linear / Slack / Notion /
-- generic destinations the founder has configured. Council 26 finding:
-- show up where the founder already lives.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_webhooks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target TEXT NOT NULL,                     -- 'slack' | 'linear' | 'notion' | 'generic'
  url TEXT NOT NULL,
  secret TEXT,                              -- HMAC signing secret (optional)
  event_types_json TEXT NOT NULL,           -- JSON array of WebhookEventType
  enabled INTEGER NOT NULL DEFAULT 1,
  last_dispatch_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pwh_product
  ON product_webhooks(product_id, enabled);
