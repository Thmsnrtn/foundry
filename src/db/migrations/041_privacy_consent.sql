-- Migration 041: Privacy consent and data residency settings
-- Tracks explicit consent for data sharing and regional data preferences.

-- privacy_consents: explicit consent records for data sharing
CREATE TABLE IF NOT EXISTS privacy_consents (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  founder_id TEXT NOT NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'benchmark_contribution',  -- anonymous metrics shared to pool
    'aggregate_insights',      -- receive insights derived from pool
    'product_improvement',     -- usage data for Foundry improvement
    'ai_training_opt_out'      -- opt out of AI training on their data
  )),
  granted INTEGER NOT NULL DEFAULT 0, -- 1=granted, 0=denied
  granted_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, consent_type)
);
CREATE INDEX IF NOT EXISTS idx_consents_product ON privacy_consents(product_id);

-- data_residency_settings: where data is stored and processed
CREATE TABLE IF NOT EXISTS data_residency_settings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  preferred_region TEXT NOT NULL DEFAULT 'us-east' CHECK (preferred_region IN ('us-east','us-west','eu-west','ap-southeast')),
  data_retention_days INTEGER NOT NULL DEFAULT 730, -- 2 years default
  delete_agent_logs_after_days INTEGER NOT NULL DEFAULT 90,
  anonymize_customer_data INTEGER NOT NULL DEFAULT 0,
  export_format TEXT NOT NULL DEFAULT 'json' CHECK (export_format IN ('json','csv','pdf')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
