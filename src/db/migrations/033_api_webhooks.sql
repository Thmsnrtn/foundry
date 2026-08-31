-- Migration 033: Public API infrastructure and outbound webhooks
-- Allows product owners to register external HTTP endpoints that receive
-- real-time event notifications from the Foundry platform.
-- Deliveries are tracked with retry metadata for reliability.

-- outbound_webhooks: registered webhook endpoints per product
-- events is a JSON array of event type strings the subscriber wants to receive,
-- e.g. ["customer.health_changed","experiment.completed","action.executed",
--       "decision.raised","briefing.generated","alert.critical"]
-- secret_hash stores a hashed shared secret used to sign payloads (HMAC-SHA256)
-- failure_count is incremented on each failed delivery attempt; used to auto-disable
-- THIS STATEMENT DID NOT RUN. `outbound_webhooks` was created by `013_voice_push.sql`, and
-- `CREATE TABLE IF NOT EXISTS` over an existing table does nothing — so the
-- columns below are a PROPOSAL, not the schema. The live shape is the earlier
-- one plus whatever later migrations added by ALTER; read
-- `docs/db/schema.snapshot.sql` for what the database actually has.
-- `tests/unit/only-the-first-create-is-the-schema.test.ts` pins the full list.
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL,
  name             TEXT NOT NULL,          -- human-readable label
  url              TEXT NOT NULL,          -- HTTPS endpoint to POST to
  secret_hash      TEXT,                   -- hashed shared secret for HMAC verification
  events           TEXT NOT NULL DEFAULT '[]',  -- JSON array of subscribed event types
  is_active        INTEGER NOT NULL DEFAULT 1,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  last_delivered_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- idx_webhooks_product moved to 056_schema_reconciliation: outbound_webhooks'
-- is_active column is added there (the canonical table is 013_voice_push's),
-- so it couldn't be indexed at 033 time (Phase 2.4).

-- webhook_deliveries: one row per attempted delivery of an event to a webhook
-- attempt_count increments on each retry; next_retry_at drives the retry scheduler
-- delivered_at is set on HTTP 2xx; failed_at is set when max retries are exhausted
-- THIS STATEMENT DID NOT RUN. `webhook_deliveries` was created by `006_api_keys_webhooks.sql`, and
-- `CREATE TABLE IF NOT EXISTS` over an existing table does nothing — so the
-- columns below are a PROPOSAL, not the schema. The live shape is the earlier
-- one plus whatever later migrations added by ALTER; read
-- `docs/db/schema.snapshot.sql` for what the database actually has.
-- `tests/unit/only-the-first-create-is-the-schema.test.ts` pins the full list.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  webhook_id      TEXT NOT NULL REFERENCES outbound_webhooks(id),
  event_type      TEXT NOT NULL,
  payload_json    TEXT NOT NULL,            -- the full JSON body sent to the endpoint
  response_status INTEGER,                  -- HTTP status code returned by the receiver
  response_body   TEXT,                     -- truncated response body for debugging
  attempt_count   INTEGER NOT NULL DEFAULT 1,
  delivered_at    TEXT,                     -- set on first successful delivery
  next_retry_at   TEXT,                     -- set when scheduling a retry
  failed_at       TEXT,                     -- set when no further retries will be attempted
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
  ON webhook_deliveries(webhook_id, created_at);

-- Partial index for the retry queue REMOVED (Phase 2.4): the canonical
-- webhook_deliveries table (006_api_keys_webhooks) has no next_retry_at /
-- failed_at columns — 033's richer redefinition is a no-op CREATE. Indexing
-- those columns failed on a fresh DB. (The 006-vs-033 webhook_deliveries
-- dual-schema is tracked with the broader integrations consolidation.)
