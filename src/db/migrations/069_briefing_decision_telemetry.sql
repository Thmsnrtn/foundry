-- =============================================================================
-- FOUNDRY — Briefing → Decision Telemetry (Wave 1, Action 1)
-- Captures the briefing-view → decision-approval loop so the weekly outcome
-- card can answer "did the founder act on what the briefing surfaced?"
-- This is the foundational telemetry every other quality measurement
-- depends on (per 300-persona review §4 Theme A).
-- =============================================================================

CREATE TABLE IF NOT EXISTS briefing_decision_links (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  briefing_id TEXT NOT NULL,
  draft_id TEXT,                            -- action_drafts.id once approved/rejected
  decision_id TEXT,                         -- decisions.id when applicable
  briefing_viewed_at TEXT NOT NULL,
  decision_acted_at TEXT,                   -- null until an action lands
  latency_ms INTEGER,                       -- acted_at - viewed_at, populated on action
  outcome TEXT,                             -- 'approved'|'rejected'|null (no action yet)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bdl_founder_created
  ON briefing_decision_links(founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bdl_product_created
  ON briefing_decision_links(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bdl_briefing
  ON briefing_decision_links(briefing_id);
CREATE INDEX IF NOT EXISTS idx_bdl_unmatched
  ON briefing_decision_links(founder_id, decision_acted_at)
  WHERE decision_acted_at IS NULL;
