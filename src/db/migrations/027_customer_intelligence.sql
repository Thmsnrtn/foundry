-- =============================================================================
-- Migration 027: Customer-Level Intelligence
-- Per-customer health scores, churn risk, expansion signals, champions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  external_id TEXT,
  name TEXT,
  email TEXT,
  company TEXT,
  plan TEXT,
  mrr_cents INTEGER DEFAULT 0,
  signed_up_at TEXT,
  last_active_at TEXT,
  health_score REAL,
  churn_risk REAL,
  expansion_potential REAL,
  is_champion INTEGER DEFAULT 0,
  tags TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_health_snapshots (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  health_score REAL,
  churn_risk REAL,
  usage_score REAL,
  support_score REAL,
  payment_score REAL,
  engagement_score REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_product ON customers(product_id);
CREATE INDEX IF NOT EXISTS idx_customers_health ON customers(product_id, health_score);
CREATE INDEX IF NOT EXISTS idx_customers_churn ON customers(product_id, churn_risk DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events ON customer_events(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_health_snap ON customer_health_snapshots(customer_id, snapshot_date);
