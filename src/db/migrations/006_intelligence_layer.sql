-- =============================================================================
-- FOUNDRY — Migration 006: Intelligence Layer
-- Daily One Thing, Signal component breakdown, Decision outcome quality.
-- =============================================================================

-- Daily insight: one AI-generated "most important thing" per product per day.
-- Generated at 7:30 UTC, surfaced on the home screen.
CREATE TABLE IF NOT EXISTS daily_insights (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,    -- ≤120 chars: the one sentence founders wake up to
  context TEXT NOT NULL,     -- 2–3 sentence elaboration
  action TEXT,               -- optional: the one concrete thing to do today
  insight_date TEXT NOT NULL, -- YYYY-MM-DD
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, insight_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_insights ON daily_insights(product_id, insight_date DESC);

-- Store the full Signal component breakdown alongside each history snapshot.
-- Enables "what changed" diffing and per-component sparklines in the future.
ALTER TABLE signal_history ADD COLUMN components_json TEXT;

-- Decision outcome quality: -1 (didn't work), 0 (mixed), 1 (worked).
-- Founders set this when recording an outcome. Powers decision analytics.
ALTER TABLE decisions ADD COLUMN outcome_valence INTEGER;
