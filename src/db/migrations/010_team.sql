-- =============================================================================
-- FOUNDRY — Migration 010: Co-Founder / Team Mode
-- Multiple founders on one product. Shared decisions, alignment scoring,
-- role-based views, and co-decision workflow.
-- =============================================================================

-- Team memberships: which founders have access to which products.
-- The product owner is already in products.owner_id.
-- This table tracks additional co-founders and collaborators.
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  role TEXT NOT NULL DEFAULT 'co_founder' CHECK(role IN (
    'co_founder', 'advisor', 'investor_observer'
  )),
  -- Role-based view permissions
  can_view_decisions BOOLEAN DEFAULT TRUE,
  can_vote_decisions BOOLEAN DEFAULT TRUE,
  can_view_financials BOOLEAN DEFAULT TRUE,
  can_view_audit BOOLEAN DEFAULT TRUE,
  can_trigger_actions BOOLEAN DEFAULT FALSE,  -- only co_founder by default
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'removed')),
  invited_by TEXT REFERENCES founders(id),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, founder_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_product ON team_members(product_id, status);
CREATE INDEX IF NOT EXISTS idx_team_members_founder ON team_members(founder_id);

-- Pending invitations (email-based, before the invitee has a Foundry account).
CREATE TABLE IF NOT EXISTS team_invitations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES founders(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'co_founder',
  token TEXT UNIQUE NOT NULL,
  message TEXT,
  accepted_at DATETIME,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_product ON team_invitations(product_id);

-- Co-decision votes: structured deliberation on Gate 2/3 decisions.
CREATE TABLE IF NOT EXISTS decision_votes (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  vote TEXT CHECK(vote IN ('approve', 'reject', 'abstain', 'needs_more_info')),
  preferred_option TEXT,       -- which option they'd choose
  rationale TEXT,              -- why they voted this way
  concerns TEXT,               -- JSON: string[] of specific concerns
  voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(decision_id, founder_id)
);

CREATE INDEX IF NOT EXISTS idx_decision_votes_decision ON decision_votes(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_votes_founder ON decision_votes(founder_id);

-- Alignment snapshots: periodic measurement of co-founder Signal interpretation.
-- Generated weekly when team has 2+ members.
CREATE TABLE IF NOT EXISTS alignment_snapshots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,        -- YYYY-MM-DD
  alignment_score INTEGER NOT NULL,   -- 0-100
  signal_consensus BOOLEAN,           -- do all founders agree on Signal interpretation?
  divergence_areas TEXT,              -- JSON: string[] of areas where views differ
  risk_state_consensus BOOLEAN,
  priority_consensus BOOLEAN,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_alignment_product ON alignment_snapshots(product_id, snapshot_date DESC);
