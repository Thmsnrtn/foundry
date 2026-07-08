-- board_packets: generated board meeting materials
CREATE TABLE IF NOT EXISTS board_packets (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  quarter TEXT NOT NULL, -- e.g. '2026-Q2'
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  narrative_json TEXT NOT NULL DEFAULT '{}',
  -- { executive_summary, key_metrics, wins, risks, asks, next_quarter_goals }
  metrics_snapshot_json TEXT NOT NULL DEFAULT '{}',
  raw_html TEXT, -- rendered board packet HTML
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','published'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_packets_quarter ON board_packets(product_id, quarter);

-- fundraising_scores: readiness assessment for raising a round
CREATE TABLE IF NOT EXISTS fundraising_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  target_round TEXT NOT NULL CHECK (target_round IN ('pre_seed','seed','series_a','series_b')),
  overall_score REAL NOT NULL, -- 0-10
  scores_json TEXT NOT NULL DEFAULT '{}',
  -- { traction: 0-10, team: 0-10, market: 0-10, unit_economics: 0-10, narrative: 0-10 }
  gaps_json TEXT NOT NULL DEFAULT '[]', -- array of { dimension, gap, recommendation }
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fundraising_product ON fundraising_scores(product_id, target_round, generated_at);

-- investor_updates: monthly investor update drafts
CREATE TABLE IF NOT EXISTS investor_updates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  month TEXT NOT NULL, -- e.g. '2026-03'
  draft_text TEXT NOT NULL, -- markdown formatted
  key_metrics_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  sent_at TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- idx_investor_updates_month moved to 056_schema_reconciliation: the `month`
-- column is added there (investor_updates was first defined in
-- 030_investor_automation without it), so it couldn't be indexed at 039 time
-- (Phase 2.4).
