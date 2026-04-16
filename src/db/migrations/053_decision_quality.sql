-- Behavioral signals that indicate decision state
CREATE TABLE IF NOT EXISTS founder_behavioral_signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,  -- 'approval_without_reading' | 'rapid_override_sequence' | 'late_night_activity' | 'override_without_reason' | 'unusual_velocity' | 'contradiction' | 'extended_inactivity'
  signal_description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low', -- 'low' | 'medium' | 'high'
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  context_json TEXT  -- what triggered the detection
);
CREATE INDEX IF NOT EXISTS idx_behavioral_signals_product ON founder_behavioral_signals(product_id, detected_at DESC);

-- Founder state assessments (rolling)
CREATE TABLE IF NOT EXISTS founder_state_assessments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  assessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  state TEXT NOT NULL,  -- 'optimal' | 'watchful' | 'stressed' | 'degraded'
  confidence REAL NOT NULL DEFAULT 0.5,
  contributing_signals_json TEXT NOT NULL,  -- JSON array of signal descriptions
  recommendation TEXT,  -- what to do about it
  recommended_deferral_hours INTEGER  -- if degraded, how long to wait before major decisions
);
CREATE INDEX IF NOT EXISTS idx_founder_state_product ON founder_state_assessments(product_id, assessed_at DESC);

-- Decision quality scores (retrospective)
CREATE TABLE IF NOT EXISTS decision_quality_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  decision_source TEXT NOT NULL,  -- 'action_execution' | 'strategic_decision' | 'override'
  source_id TEXT NOT NULL,
  quality_score INTEGER,  -- 1-5, filled in retrospectively or inferred from outcomes
  context_richness INTEGER,  -- 0-3: 0=no context, 1=minimal, 2=good, 3=full
  time_of_day INTEGER,  -- hour (0-23)
  days_since_last_rest INTEGER,  -- inferred
  outcome TEXT,  -- 'positive' | 'neutral' | 'negative' | 'pending'
  scored_at TEXT NOT NULL DEFAULT (datetime('now'))
);
