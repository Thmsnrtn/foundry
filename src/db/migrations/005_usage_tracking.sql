-- =============================================================================
-- FOUNDRY — AI Usage Tracking & Data Export
-- Tracks per-product token usage for cost monitoring.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  model TEXT NOT NULL,
  call_type TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_product ON ai_usage_log(product_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_product_date ON ai_usage_log(product_id, created_at);

-- Data export request tracking (GDPR Article 20)
CREATE TABLE IF NOT EXISTS data_export_requests (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  download_url TEXT,
  expires_at DATETIME
);

-- Account deletion request tracking (GDPR Article 17)
CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'completed')),
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME,
  completed_at DATETIME,
  confirmation_token TEXT
);

-- Add last_seen_at to founders (if not already present from migration 003)
-- ALTER TABLE founders ADD COLUMN last_seen_at DATETIME;
