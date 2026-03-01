-- =============================================================================
-- FOUNDRY — Migration 003: UX Intelligence Layer
-- Tables for onboarding tour, milestones, notifications, dimension hints, gates.
-- =============================================================================

CREATE TABLE IF NOT EXISTS onboarding_tour (
  founder_id TEXT PRIMARY KEY REFERENCES founders(id),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  current_step INTEGER DEFAULT 1,
  completed_steps TEXT DEFAULT '[]',
  completed_at DATETIME,
  skipped_at DATETIME,
  product_id TEXT REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS milestone_events (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  milestone_key TEXT NOT NULL,
  milestone_title TEXT NOT NULL,
  milestone_description TEXT NOT NULL,
  seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_milestones_founder ON milestone_events(founder_id, seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_unique ON milestone_events(founder_id, product_id, milestone_key);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  product_id TEXT REFERENCES products(id),
  type TEXT NOT NULL CHECK(type IN (
    'milestone','risk_state_change','stressor_critical',
    'decision_overdue','pr_opened','pr_merged','audit_complete',
    'competitive_signal','dna_nudge','system'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  action_label TEXT,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_founder ON notifications(founder_id, read_at);

CREATE TABLE IF NOT EXISTS dimension_hints (
  id TEXT PRIMARY KEY,
  audit_score_id TEXT NOT NULL REFERENCES audit_scores(id),
  dimension TEXT NOT NULL,
  hint_text TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dimension_hints_unique ON dimension_hints(audit_score_id, dimension);

CREATE TABLE IF NOT EXISTS gate_events (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  feature_key TEXT NOT NULL,
  tier_required TEXT NOT NULL,
  tier_actual TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gate_events_founder ON gate_events(founder_id);

ALTER TABLE founders ADD COLUMN onboarding_completed_at DATETIME;
ALTER TABLE founders ADD COLUMN last_seen_at DATETIME;

ALTER TABLE lifecycle_state ADD COLUMN unread_competitive_signals INTEGER DEFAULT 0;
ALTER TABLE lifecycle_state ADD COLUMN audit_age_days INTEGER DEFAULT 0;
ALTER TABLE lifecycle_state ADD COLUMN unread_milestones INTEGER DEFAULT 0;
ALTER TABLE lifecycle_state ADD COLUMN open_remediation_prs INTEGER DEFAULT 0;
ALTER TABLE lifecycle_state ADD COLUMN pending_decisions_count INTEGER DEFAULT 0;
