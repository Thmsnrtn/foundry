-- =============================================================================
-- Migration 006: Founder Health Dashboard
-- Tracks founder engagement, burnout risk, key-person dependency.
-- =============================================================================

CREATE TABLE IF NOT EXISTS founder_health (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  personal_runway_months REAL,
  weekly_hours_available REAL,
  immigration_status TEXT,
  visa_expiry_date TEXT,
  key_persons TEXT,
  engagement_trend TEXT DEFAULT 'stable',
  last_login_streak INTEGER DEFAULT 0,
  avg_decision_response_hours REAL,
  motivation_score REAL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(founder_id)
);

CREATE TABLE IF NOT EXISTS founder_health_snapshots (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  motivation_score REAL,
  engagement_trend TEXT,
  weekly_hours_available REAL,
  personal_runway_months REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fh_founder ON founder_health(founder_id);
CREATE INDEX IF NOT EXISTS idx_fhs_founder_date ON founder_health_snapshots(founder_id, snapshot_date);
