-- =============================================================================
-- Migration 024: Founder Network & Matchmaking
-- Network profiles, introductions, peer reviews, cohort groups.
-- =============================================================================

CREATE TABLE IF NOT EXISTS network_profiles (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  display_name TEXT,
  bio TEXT,
  sector TEXT,
  growth_stage TEXT,
  expertise_areas TEXT,
  seeking_help_with TEXT,
  willing_to_help_with TEXT,
  timezone TEXT,
  visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(founder_id)
);

CREATE TABLE IF NOT EXISTS introductions (
  id TEXT PRIMARY KEY,
  founder_a_id TEXT NOT NULL,
  founder_b_id TEXT NOT NULL,
  match_reason TEXT NOT NULL,
  match_score REAL,
  status TEXT DEFAULT 'proposed',
  proposed_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  declined_at TEXT,
  feedback_a TEXT,
  feedback_b TEXT
);

CREATE TABLE IF NOT EXISTS peer_reviews (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  reviewee_product_id TEXT NOT NULL,
  review_type TEXT NOT NULL,
  content TEXT NOT NULL,
  rating INTEGER,
  credits_earned INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS cohort_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT,
  growth_stage TEXT,
  max_members INTEGER DEFAULT 8,
  meeting_cadence TEXT DEFAULT 'monthly',
  next_meeting_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cohort_memberships (
  id TEXT PRIMARY KEY,
  cohort_group_id TEXT NOT NULL REFERENCES cohort_groups(id),
  founder_id TEXT NOT NULL REFERENCES founders(id),
  joined_at TEXT DEFAULT (datetime('now')),
  active INTEGER DEFAULT 1,
  UNIQUE(cohort_group_id, founder_id)
);

CREATE INDEX IF NOT EXISTS idx_network_profiles_founder ON network_profiles(founder_id);
CREATE INDEX IF NOT EXISTS idx_network_profiles_sector ON network_profiles(sector, growth_stage);
CREATE INDEX IF NOT EXISTS idx_introductions_founders ON introductions(founder_a_id);
CREATE INDEX IF NOT EXISTS idx_peer_reviews_reviewer ON peer_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_cohort_members ON cohort_memberships(cohort_group_id);
