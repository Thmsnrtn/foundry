-- =============================================================================
-- FOUNDRY — Weekend Mode + Founder Feedback (Wave 2: actions 14, 16, 19)
-- 1. products.cadence_mode: 'standard' | 'weekend' | null. Weekend mode
--    drops agent cadences and silences non-critical pushes for the
--    side-project founder segment (Council 14 finding).
-- 2. founder_feedback: NPS / CSAT one-tap responses (Council 18 finding).
-- 3. rejection_streaks: tracks recent decision rejections per (founder,
--    product, agent) so the system can prompt for calibration when a
--    founder has rejected N in a row (Council 14 finding).
-- =============================================================================

ALTER TABLE products ADD COLUMN cadence_mode TEXT;

CREATE TABLE IF NOT EXISTS founder_feedback (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT,
  feedback_type TEXT NOT NULL,             -- 'nps' | 'csat' | 'rejection_reason'
  score INTEGER,                            -- 0-10 for NPS, 1-5 for CSAT, null for rejection_reason
  category TEXT,                            -- 'detractor'|'passive'|'promoter' computed for nps
  comment TEXT,                             -- optional short comment
  context_json TEXT,                        -- JSON: { decisionId, agentName, ... } where applicable
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_founder ON founder_feedback(founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_product ON founder_feedback(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON founder_feedback(feedback_type, created_at DESC);

CREATE TABLE IF NOT EXISTS rejection_streaks (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT,                          -- nullable: aggregate streak across all agents
  consecutive_rejections INTEGER NOT NULL DEFAULT 0,
  last_rejected_at TEXT,
  last_calibration_prompt_at TEXT,         -- prevent re-prompting too aggressively
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rejection_streak_unique
  ON rejection_streaks(founder_id, product_id, COALESCE(agent_name, '*'));
