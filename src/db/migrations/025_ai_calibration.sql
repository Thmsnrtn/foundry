-- =============================================================================
-- Migration 025: Psychology-Aware AI Calibration
-- Per-founder AI personality profiles that shape all Claude outputs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS founder_ai_profile (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  communication_style TEXT DEFAULT 'standard',
  preferred_length TEXT DEFAULT 'medium',
  jargon_level TEXT DEFAULT 'moderate',
  encouragement_level TEXT DEFAULT 'balanced',
  directness_level TEXT DEFAULT 'moderate',
  data_density TEXT DEFAULT 'moderate',
  decision_framing TEXT DEFAULT 'balanced',
  active_psychology_patterns TEXT,
  experience_level TEXT DEFAULT 'experienced',
  custom_instructions TEXT,
  calibrated_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(founder_id)
);

CREATE TABLE IF NOT EXISTS ai_output_feedback (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  output_type TEXT NOT NULL,
  output_id TEXT,
  rating INTEGER,
  feedback TEXT,
  too_long INTEGER DEFAULT 0,
  too_short INTEGER DEFAULT 0,
  too_technical INTEGER DEFAULT 0,
  too_simple INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_profile_founder ON founder_ai_profile(founder_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_founder ON ai_output_feedback(founder_id);
