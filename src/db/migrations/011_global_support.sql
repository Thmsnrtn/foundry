-- =============================================================================
-- Migration 011: Global Founder Support
-- PPP pricing, currency tracking, geopolitical signals.
-- =============================================================================

ALTER TABLE founders ADD COLUMN country_code TEXT DEFAULT 'US';

ALTER TABLE founders ADD COLUMN local_currency TEXT DEFAULT 'USD';

ALTER TABLE founders ADD COLUMN ppp_factor REAL DEFAULT 1.0;

ALTER TABLE metric_snapshots ADD COLUMN local_currency_mrr REAL;

ALTER TABLE metric_snapshots ADD COLUMN exchange_rate REAL DEFAULT 1.0;

CREATE TABLE IF NOT EXISTS geopolitical_signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  description TEXT NOT NULL,
  affected_markets TEXT,
  source TEXT,
  detected_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_geo_signals_product ON geopolitical_signals(product_id);
CREATE INDEX IF NOT EXISTS idx_geo_signals_status ON geopolitical_signals(status);
