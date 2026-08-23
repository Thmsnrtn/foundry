-- =============================================================================
-- Migration 021: Automatic Data Ingestion Framework
-- Integration registry, credential vault, sync tracking.
-- =============================================================================

-- THIS STATEMENT DID NOT RUN. `integrations` was created by `008_integrations.sql`, and
-- `CREATE TABLE IF NOT EXISTS` over an existing table does nothing — so the
-- columns below are a PROPOSAL, not the schema. The live shape is the earlier
-- one plus whatever later migrations added by ALTER; read
-- `docs/db/schema.snapshot.sql` for what the database actually has.
-- `tests/unit/only-the-first-create-is-the-schema.test.ts` pins the full list.
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT DEFAULT 'pending_auth',
  credentials TEXT,
  config TEXT,
  last_sync_at TEXT,
  last_sync_status TEXT,
  sync_frequency_minutes INTEGER DEFAULT 60,
  error_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, provider)
);

-- THIS STATEMENT DID NOT RUN. `integration_sync_log` was created by `008_integrations.sql`, and
-- `CREATE TABLE IF NOT EXISTS` over an existing table does nothing — so the
-- columns below are a PROPOSAL, not the schema. The live shape is the earlier
-- one plus whatever later migrations added by ALTER; read
-- `docs/db/schema.snapshot.sql` for what the database actually has.
-- `tests/unit/only-the-first-create-is-the-schema.test.ts` pins the full list.
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id),
  product_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  records_processed INTEGER DEFAULT 0,
  metrics_updated TEXT,
  errors TEXT,
  duration_ms INTEGER,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  data TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_integrations_product ON integrations(product_id);
-- idx_integrations_provider moved to 056_schema_reconciliation: `provider` is
-- added there (the canonical table is 008_integrations, which has no provider
-- column), so indexing it here failed on a fresh DB (Phase 2.4).
CREATE INDEX IF NOT EXISTS idx_sync_log_integration ON integration_sync_log(integration_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_product ON stripe_events(product_id, processed);
