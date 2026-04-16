-- =============================================================================
-- FOUNDRY — Migration 007: Weekly Operating Plan + Metric Ingest
-- =============================================================================

-- Weekly Operating Plan: 3 prioritized actions per product per week.
-- Generated every Monday morning. Founders check items off as they execute.
CREATE TABLE IF NOT EXISTS weekly_plans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week_of TEXT NOT NULL,          -- ISO YYYY-Www (e.g. 2026-W10)
  signal_at_generation INTEGER,  -- Signal score when plan was made
  items_json TEXT NOT NULL,       -- JSON: [{id, text, category, impact, done}]
  synthesis TEXT,                 -- 1-2 sentence framing paragraph
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, week_of)
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans ON weekly_plans(product_id, week_of DESC);

-- Metric ingest: each product gets a secret URL for automated metric updates.
-- Any tool (Stripe, Zapier, cron) can POST to /ingest/:token.
ALTER TABLE products ADD COLUMN ingest_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_ingest_token ON products(ingest_token);
