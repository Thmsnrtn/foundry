-- =============================================================================
-- Migration 016: Founder Psychology Engine
-- Detects behavioral patterns like overcorrection, perfectionism, isolation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS founder_psychology_insights (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence REAL,
  evidence TEXT,
  intervention_suggestion TEXT,
  surfaced_at TEXT DEFAULT (datetime('now')),
  acknowledged INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_psych_founder ON founder_psychology_insights(founder_id);
CREATE INDEX IF NOT EXISTS idx_psych_product ON founder_psychology_insights(product_id);
CREATE INDEX IF NOT EXISTS idx_psych_status ON founder_psychology_insights(status);
