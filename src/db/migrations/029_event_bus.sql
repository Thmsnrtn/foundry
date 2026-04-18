-- =============================================================================
-- Migration 029: Real-Time Event Bus
-- Event ingestion, routing rules, cascade chains, anomaly detection.
-- =============================================================================

CREATE TABLE IF NOT EXISTS event_stream (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  payload TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  cascades_triggered TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_rules (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event_type TEXT NOT NULL,
  condition TEXT,
  action_type TEXT NOT NULL,
  action_config TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  times_fired INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  expected_value REAL,
  actual_value REAL,
  deviation_sigma REAL,
  description TEXT,
  status TEXT DEFAULT 'active',
  detected_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_stream ON event_stream(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_stream_unprocessed ON event_stream(processed, created_at);
CREATE INDEX IF NOT EXISTS idx_event_rules ON event_rules(product_id, trigger_event_type);
CREATE INDEX IF NOT EXISTS idx_anomalies ON anomalies(product_id, status);
