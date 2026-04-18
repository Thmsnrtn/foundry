-- =============================================================================
-- Migration 018: Cross-Product Wisdom Network
-- Anonymized insight aggregation across opted-in products.
-- =============================================================================

ALTER TABLE founders ADD COLUMN wisdom_network_opted_in INTEGER DEFAULT 0;

ALTER TABLE founders ADD COLUMN wisdom_network_consent_date TEXT;

CREATE TABLE IF NOT EXISTS cross_product_insights (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  growth_stage TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  description TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  confidence REAL,
  avg_impact REAL,
  conditions TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cpi_sector ON cross_product_insights(sector);
CREATE INDEX IF NOT EXISTS idx_cpi_stage ON cross_product_insights(growth_stage);
CREATE INDEX IF NOT EXISTS idx_cpi_type ON cross_product_insights(insight_type);
