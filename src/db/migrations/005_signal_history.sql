-- =============================================================================
-- FOUNDRY — Migration 005: Signal History, Share Tokens, Decision Follow-ups
-- =============================================================================

-- Signal history for sparklines, trend detection, and proactive alerts.
-- UPSERT strategy: one record per product per day, updated if score changes.
CREATE TABLE IF NOT EXISTS signal_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  tier TEXT NOT NULL,
  risk_state TEXT NOT NULL,
  stressor_count INTEGER NOT NULL DEFAULT 0,
  snapshot_date TEXT NOT NULL,   -- YYYY-MM-DD, one per product per day
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_signal_history ON signal_history(product_id, snapshot_date DESC);

-- Investor/advisor read-only share token on products.
ALTER TABLE products ADD COLUMN share_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_share_token ON products(share_token);

-- Decision outcome follow-up scheduling.
-- Set to 30 days after resolution so founders are nudged to log what happened.
ALTER TABLE decisions ADD COLUMN follow_up_at DATETIME;
