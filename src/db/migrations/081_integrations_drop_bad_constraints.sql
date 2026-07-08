-- =============================================================================
-- Migration 081: Fix integrations constraints (walkthrough finding)
--
-- The canonical `integrations` table (008_integrations, widened by 056) carries
-- constraints from a DIFFERENT integration subsystem than the runtime fabric
-- (services/integration/) actually uses:
--   • type CHECK IN ('stripe','posthog',...) — but connectIntegration writes
--     the DIRECTION ('inbound'/'outbound'/'bidirectional') to `type`, so every
--     connect 500s on a real DB (integrations can never connect).
--   • UNIQUE(product_id, type) — with type=direction this collides the moment a
--     founder connects two same-direction integrations (posthog + stripe are
--     both 'inbound').
--
-- The fabric keys on `name` (the provider) and validates values in the app.
-- Rebuild the table dropping the type/status CHECKs and re-keying uniqueness on
-- (product_id, name). All 26 columns + data preserved. (Phase 2.4-adjacent.)
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS integrations_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL,                          -- CHECK dropped (app-validated; fabric uses direction)
  status TEXT NOT NULL DEFAULT 'pending',      -- CHECK dropped (app-validated)
  credentials_json TEXT,
  config_json TEXT,
  last_synced_at DATETIME,
  last_error TEXT,
  sync_cursor TEXT,
  records_synced_total INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT,
  provider TEXT,
  credentials TEXT,
  config TEXT,
  last_sync_at TEXT,
  last_sync_status TEXT,
  sync_frequency_minutes INTEGER DEFAULT 60,
  error_count INTEGER DEFAULT 0,
  name TEXT,
  authorized_agents TEXT DEFAULT '["all"]',
  total_inbound_events INTEGER DEFAULT 0,
  total_outbound_actions INTEGER DEFAULT 0,
  error_count_trailing_7d INTEGER DEFAULT 0,
  cost_trailing_30d_usd REAL DEFAULT 0.0
);

INSERT INTO integrations_new (
  id, product_id, type, status, credentials_json, config_json, last_synced_at,
  last_error, sync_cursor, records_synced_total, created_at, updated_at, owner_id,
  provider, credentials, config, last_sync_at, last_sync_status,
  sync_frequency_minutes, error_count, name, authorized_agents,
  total_inbound_events, total_outbound_actions, error_count_trailing_7d,
  cost_trailing_30d_usd
)
  SELECT
    id, product_id, type, status, credentials_json, config_json, last_synced_at,
    last_error, sync_cursor, records_synced_total, created_at, updated_at, owner_id,
    provider, credentials, config, last_sync_at, last_sync_status,
    sync_frequency_minutes, error_count, name, authorized_agents,
    total_inbound_events, total_outbound_actions, error_count_trailing_7d,
    cost_trailing_30d_usd
  FROM integrations;

DROP TABLE integrations;
ALTER TABLE integrations_new RENAME TO integrations;

CREATE INDEX IF NOT EXISTS idx_integrations_product ON integrations(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_product_name ON integrations(product_id, name);

PRAGMA foreign_keys=ON;
