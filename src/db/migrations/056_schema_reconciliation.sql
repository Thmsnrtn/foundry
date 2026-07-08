-- =============================================================================
-- Migration 056: Schema Reconciliation (DEFECT-0042)
-- Seven tables were defined multiple times across migrations with incompatible
-- schemas.  Because SQLite's CREATE TABLE IF NOT EXISTS silently skips
-- duplicates, only the *first* definition's columns exist.  Later code that
-- references columns from the second definition fails at runtime.
--
-- This migration adds every missing column using ALTER TABLE … ADD COLUMN.
-- SQLite will raise "duplicate column" for columns that already exist;
-- the migration runner swallows those errors, making this idempotent.
-- =============================================================================

-- ─── integrations (first: 008_integrations, dupes: 021_data_ingestion, 021_integration_fabric) ──

-- Columns from 021_data_ingestion not present in 008_integrations
ALTER TABLE integrations ADD COLUMN owner_id TEXT;
ALTER TABLE integrations ADD COLUMN provider TEXT;
ALTER TABLE integrations ADD COLUMN credentials TEXT;
ALTER TABLE integrations ADD COLUMN config TEXT;
ALTER TABLE integrations ADD COLUMN last_sync_at TEXT;
ALTER TABLE integrations ADD COLUMN last_sync_status TEXT;
ALTER TABLE integrations ADD COLUMN sync_frequency_minutes INTEGER DEFAULT 60;
ALTER TABLE integrations ADD COLUMN error_count INTEGER DEFAULT 0;

-- Columns from 021_integration_fabric not present in 008_integrations
ALTER TABLE integrations ADD COLUMN name TEXT;
ALTER TABLE integrations ADD COLUMN authorized_agents TEXT DEFAULT '["all"]';
ALTER TABLE integrations ADD COLUMN total_inbound_events INTEGER DEFAULT 0;
ALTER TABLE integrations ADD COLUMN total_outbound_actions INTEGER DEFAULT 0;
ALTER TABLE integrations ADD COLUMN error_count_trailing_7d INTEGER DEFAULT 0;
ALTER TABLE integrations ADD COLUMN cost_trailing_30d_usd REAL DEFAULT 0.0;

-- Index moved here from 021_data_ingestion — `provider` only exists after the
-- ALTER above, so it couldn't be indexed at 021 time (Phase 2.4).
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider, status);

-- ─── integration_sync_log (first: 008_integrations, dupe: 021_data_ingestion) ──

ALTER TABLE integration_sync_log ADD COLUMN provider TEXT;
ALTER TABLE integration_sync_log ADD COLUMN sync_type TEXT;
ALTER TABLE integration_sync_log ADD COLUMN errors TEXT;
ALTER TABLE integration_sync_log ADD COLUMN duration_ms INTEGER;

-- ─── voice_sessions (first: 013_voice_push, dupe: 031_voice_coo) ──

ALTER TABLE voice_sessions ADD COLUMN chat_session_id TEXT;
ALTER TABLE voice_sessions ADD COLUMN extracted_decisions TEXT;
ALTER TABLE voice_sessions ADD COLUMN extracted_actions TEXT;
ALTER TABLE voice_sessions ADD COLUMN summary TEXT;
ALTER TABLE voice_sessions ADD COLUMN audio_url TEXT;
ALTER TABLE voice_sessions ADD COLUMN status TEXT DEFAULT 'active';

-- ─── outbound_webhooks (first: 013_voice_push, dupe: 033_api_webhooks) ──

ALTER TABLE outbound_webhooks ADD COLUMN name TEXT;
ALTER TABLE outbound_webhooks ADD COLUMN secret_hash TEXT;
ALTER TABLE outbound_webhooks ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE outbound_webhooks ADD COLUMN updated_at TEXT;

-- Index moved from 033_api_webhooks — is_active only exists after the ALTER
-- above (Phase 2.4).
CREATE INDEX IF NOT EXISTS idx_webhooks_product ON outbound_webhooks(product_id, is_active);

-- ─── investor_updates (first: 030_investor_automation, dupe: 039_investor_layer) ──

ALTER TABLE investor_updates ADD COLUMN month TEXT;
ALTER TABLE investor_updates ADD COLUMN draft_text TEXT;
ALTER TABLE investor_updates ADD COLUMN key_metrics_json TEXT DEFAULT '{}';
ALTER TABLE investor_updates ADD COLUMN generated_at TEXT;

-- Index moved from 039_investor_layer — `month` only exists after the ALTER
-- above (Phase 2.4).
CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_updates_month ON investor_updates(product_id, month);

-- ─── experiments (first: 023_experiments_strategy, dupe: 028_growth_experiments) ──

ALTER TABLE experiments ADD COLUMN owner_id TEXT;
ALTER TABLE experiments ADD COLUMN hypothesis TEXT;
ALTER TABLE experiments ADD COLUMN experiment_type TEXT;
ALTER TABLE experiments ADD COLUMN variants TEXT;
ALTER TABLE experiments ADD COLUMN primary_metric TEXT;
ALTER TABLE experiments ADD COLUMN secondary_metrics TEXT;
ALTER TABLE experiments ADD COLUMN traffic_split TEXT;
ALTER TABLE experiments ADD COLUMN sample_size_target INTEGER;
ALTER TABLE experiments ADD COLUMN current_sample_size INTEGER DEFAULT 0;
ALTER TABLE experiments ADD COLUMN ended_at TEXT;
ALTER TABLE experiments ADD COLUMN results TEXT;
ALTER TABLE experiments ADD COLUMN confidence_level REAL;
ALTER TABLE experiments ADD COLUMN decision_id TEXT;

-- ─── board_packets (first: 011_investor, dupe: 039_investor_layer) ──

ALTER TABLE board_packets ADD COLUMN narrative_json TEXT DEFAULT '{}';
ALTER TABLE board_packets ADD COLUMN metrics_snapshot_json TEXT DEFAULT '{}';
ALTER TABLE board_packets ADD COLUMN raw_html TEXT;
