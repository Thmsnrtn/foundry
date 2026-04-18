-- =============================================================================
-- Migration 008: Non-Code Founder Track
-- Supports founders who build with no-code tools or outsourced development.
-- =============================================================================

ALTER TABLE products ADD COLUMN build_platform TEXT DEFAULT 'custom_code';

CREATE TABLE IF NOT EXISTS web_audit_results (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  url TEXT NOT NULL,
  lighthouse_scores TEXT,
  page_analysis TEXT,
  trust_signals TEXT,
  mobile_responsiveness TEXT,
  findings TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_recommendations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  priority TEXT DEFAULT 'medium',
  estimated_cost_range TEXT,
  estimated_timeline TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_audit_product ON web_audit_results(product_id);
CREATE INDEX IF NOT EXISTS idx_vendor_rec_product ON vendor_recommendations(product_id);
