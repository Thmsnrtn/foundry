-- =============================================================================
-- FOUNDRY — V3.1 Layer B: Taste Journals
-- Per-product per-agent founder ratings of agent-produced artifacts.
-- Distinct from `ai_output_feedback` (per-founder generic rating with
-- dimensional flags). Taste journal is structured around three anchors:
-- feels_right / feels_off / missing_something — the categories Vesper and
-- Lyric identified as load-bearing for distinguishing in-voice from
-- training-distribution-median output.
-- =============================================================================

CREATE TABLE IF NOT EXISTS taste_journals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,                   -- e.g. 'beacon', 'scribe', 'harbor'
  artifact_type TEXT NOT NULL,                -- 'email_draft'|'blog_draft'|'cs_message'|'pricing_copy'|'landing_block'|other
  artifact_excerpt TEXT NOT NULL,             -- the actual content rated (or excerpt for long artifacts)
  artifact_full_id TEXT,                      -- optional: link to e.g. agent_session output, decision id
  rating TEXT NOT NULL,                       -- 'feels_right'|'feels_off'|'missing_something'
  rating_dimensions TEXT,                     -- JSON: per-dimension flags (tone_off, claim_too_strong, etc.)
  founder_notes TEXT,                         -- free-form: "remove the qualifier", "best version so far"
  rated_at TEXT NOT NULL DEFAULT (datetime('now')),
  rated_in_session_id TEXT                    -- groups ratings into calibration sessions
);

CREATE INDEX IF NOT EXISTS idx_taste_journals_product_agent
  ON taste_journals(product_id, agent_name, rated_at DESC);
CREATE INDEX IF NOT EXISTS idx_taste_journals_session
  ON taste_journals(rated_in_session_id);
CREATE INDEX IF NOT EXISTS idx_taste_journals_rating
  ON taste_journals(product_id, agent_name, rating, rated_at DESC);
