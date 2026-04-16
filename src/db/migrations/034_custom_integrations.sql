-- Migration 034: Custom webhook source integration
-- Allows products to receive arbitrary inbound webhook payloads and route them
-- into the agent event pipeline via a unique per-source endpoint token.
-- field_mappings defines how source payload fields are normalised before storage.

-- custom_webhook_sources: one row per configured inbound webhook source
-- endpoint_token forms part of the public webhook URL, e.g.
--   POST /webhooks/inbound/{endpoint_token}
-- field_mappings is a JSON array of mapping objects:
--   [{ "source_field": "customer_id", "target_field": "external_customer_id", "transform": "string" }]
-- authorized_agents controls which agents can consume events from this source;
--   default ["all"] means every agent may read it
-- total_events_received is a running count incremented on each successful ingest
CREATE TABLE IF NOT EXISTS custom_webhook_sources (
  id                     TEXT PRIMARY KEY,
  product_id             TEXT NOT NULL,
  name                   TEXT NOT NULL,            -- human label, e.g. "Stripe Billing Events"
  description            TEXT,
  endpoint_token         TEXT NOT NULL UNIQUE,     -- random token forming the inbound URL
  field_mappings         TEXT NOT NULL DEFAULT '[]',  -- JSON array of mapping objects
  default_event_type     TEXT NOT NULL DEFAULT 'custom_event',
  authorized_agents      TEXT NOT NULL DEFAULT '["all"]',  -- JSON array
  total_events_received  INTEGER NOT NULL DEFAULT 0,
  last_received_at       TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_custom_webhook_sources_product
  ON custom_webhook_sources(product_id, is_active);
