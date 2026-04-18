-- =============================================================================
-- Migration 030: Investor & Board Automation
-- Auto-generated updates, board decks, fundraise readiness, data rooms.
-- =============================================================================

CREATE TABLE IF NOT EXISTS investor_updates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  period TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  metrics_snapshot TEXT,
  highlights TEXT,
  lowlights TEXT,
  asks TEXT,
  status TEXT DEFAULT 'draft',
  sent_at TEXT,
  recipients TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS board_decks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  period TEXT NOT NULL,
  slides TEXT NOT NULL,
  data_sources TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fundraise_readiness (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  target_round TEXT,
  overall_score REAL,
  dimension_scores TEXT,
  gaps TEXT,
  recommendations TEXT,
  assessed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_investor_updates ON investor_updates(product_id, period);
CREATE INDEX IF NOT EXISTS idx_board_decks ON board_decks(product_id);
CREATE INDEX IF NOT EXISTS idx_fundraise ON fundraise_readiness(product_id);
