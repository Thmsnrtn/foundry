-- =============================================================================
-- Migration 012: Business Model Intelligence
-- Unit economics, revenue model classification, seasonal normalization.
-- =============================================================================

CREATE TABLE IF NOT EXISTS business_model_profile (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  revenue_model TEXT NOT NULL,
  avg_cogs_per_customer REAL,
  avg_cac REAL,
  cac_payback_months REAL,
  contribution_margin REAL,
  ltv_estimate REAL,
  ltv_cac_ratio REAL,
  pricing_to_value_ratio REAL,
  is_seasonal INTEGER DEFAULT 0,
  seasonal_peak_months TEXT,
  seasonal_baseline_factor REAL,
  services_revenue_percentage REAL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id)
);

CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  arpu REAL,
  cogs_per_customer REAL,
  contribution_margin REAL,
  cac REAL,
  cac_payback_months REAL,
  ltv REAL,
  ltv_cac_ratio REAL,
  gross_margin REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bmp_product ON business_model_profile(product_id);
CREATE INDEX IF NOT EXISTS idx_ue_product_date ON unit_economics_snapshots(product_id, snapshot_date);
