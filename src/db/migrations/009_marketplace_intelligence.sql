-- =============================================================================
-- Migration 009: Marketplace Intelligence Mode
-- Dual-sided marketplace metrics, trust audit, and liquidity scoring.
-- =============================================================================

CREATE TABLE IF NOT EXISTS marketplace_metrics (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  supply_count INTEGER,
  demand_count INTEGER,
  match_rate REAL,
  time_to_match_hours REAL,
  supply_demand_ratio REAL,
  liquidity_score REAL,
  disintermediation_risk REAL,
  supply_churn_rate REAL,
  demand_churn_rate REAL,
  take_rate REAL,
  gmv REAL,
  net_revenue REAL,
  avg_transaction_value REAL,
  geographic_concentration REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketplace_trust_audit (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  has_ratings INTEGER DEFAULT 0,
  has_identity_verification INTEGER DEFAULT 0,
  has_dispute_resolution INTEGER DEFAULT 0,
  has_payment_escrow INTEGER DEFAULT 0,
  has_quality_standards INTEGER DEFAULT 0,
  has_insurance_guarantee INTEGER DEFAULT 0,
  trust_score REAL,
  findings TEXT,
  audited_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mp_metrics_product ON marketplace_metrics(product_id);
CREATE INDEX IF NOT EXISTS idx_mp_metrics_date ON marketplace_metrics(product_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_mp_trust_product ON marketplace_trust_audit(product_id);
