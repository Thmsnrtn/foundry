-- =============================================================================
-- FOUNDRY — Migration 011: Investor Layer
-- Live investor dashboards, board packets, funding readiness score,
-- annotated decisions, and milestone push notifications.
-- =============================================================================

-- Investor profiles: named investors/advisors who can view live dashboards.
CREATE TABLE IF NOT EXISTS investors (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  firm TEXT,
  relationship TEXT CHECK(relationship IN (
    'lead_investor', 'angel', 'advisor', 'board_member', 'observer'
  )),
  -- Access control
  access_token TEXT UNIQUE NOT NULL,     -- URL-safe token for live dashboard
  access_expires_at DATETIME,            -- null = no expiry
  can_comment BOOLEAN DEFAULT FALSE,     -- can they annotate decisions?
  notify_on_milestones BOOLEAN DEFAULT TRUE,
  notify_on_risk_state_change BOOLEAN DEFAULT FALSE,
  last_viewed_at DATETIME,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_investors_product ON investors(product_id, status);
CREATE INDEX IF NOT EXISTS idx_investors_token ON investors(access_token);

-- Investor annotations on decisions (read-only perspective, not a vote).
CREATE TABLE IF NOT EXISTS investor_annotations (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  investor_id TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  content TEXT NOT NULL,           -- their perspective / question
  annotation_type TEXT CHECK(annotation_type IN (
    'concern', 'endorsement', 'question', 'context', 'precedent'
  )),
  is_private BOOLEAN DEFAULT FALSE, -- private to investor (not shown to other investors)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_investor_annotations_decision ON investor_annotations(decision_id);
CREATE INDEX IF NOT EXISTS idx_investor_annotations_investor ON investor_annotations(investor_id);

-- Board packets: quarterly narrative PDFs auto-drafted from Signal history.
CREATE TABLE IF NOT EXISTS board_packets (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quarter TEXT NOT NULL,               -- e.g. "2026-Q1"
  period_start TEXT NOT NULL,          -- YYYY-MM-DD
  period_end TEXT NOT NULL,            -- YYYY-MM-DD
  -- Sections (all JSON or Markdown)
  executive_summary TEXT,              -- AI-generated narrative
  signal_narrative TEXT,               -- Signal trajectory story
  key_decisions_made TEXT,             -- JSON: array of resolved decisions
  milestones_crossed TEXT,             -- JSON: array of lifecycle/milestone events
  stressors_resolved TEXT,             -- JSON: stressors resolved this quarter
  stressors_active TEXT,               -- JSON: current open stressors
  mrr_narrative TEXT,                  -- Revenue story
  cohort_narrative TEXT,               -- Retention/activation story
  competitive_narrative TEXT,          -- Competitive landscape story
  next_quarter_focus TEXT,             -- Forward-looking 90-day plan
  -- Meta
  signal_start INTEGER,
  signal_end INTEGER,
  signal_delta INTEGER,
  generated_at DATETIME,
  finalized_at DATETIME,              -- when founder marks it ready to share
  shared_with TEXT,                   -- JSON: investor_id[]
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'finalized', 'shared'))
);

CREATE INDEX IF NOT EXISTS idx_board_packets_product ON board_packets(product_id, quarter DESC);

-- Funding readiness score: sub-score of the audit specifically for fundraising.
-- Generated on demand or when crossing lifecycle gates.
CREATE TABLE IF NOT EXISTS funding_readiness (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,              -- 0-100
  -- Component scores
  mrr_trajectory_score INTEGER,       -- Is revenue trending right?
  churn_score INTEGER,                 -- Is churn acceptable for stage?
  activation_score INTEGER,            -- Is activation rate above baseline?
  technical_debt_score INTEGER,        -- Derived from latest audit composite
  decision_track_record_score INTEGER, -- Outcome valence from decision history
  team_completeness_score INTEGER,     -- Co-founder mode: is team whole?
  market_clarity_score INTEGER,        -- DNA completion: do you know your market?
  -- Narrative
  verdict TEXT CHECK(verdict IN ('raise_ready', 'almost_ready', 'not_ready')),
  key_gaps TEXT,                       -- JSON: string[] — what's blocking raise readiness
  narrative TEXT,                      -- AI-generated 3-sentence assessment
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, date(created_at))
);

CREATE INDEX IF NOT EXISTS idx_funding_readiness_product ON funding_readiness(product_id, created_at DESC);

-- Deal rooms: share a specific decision package with potential investors.
CREATE TABLE IF NOT EXISTS deal_rooms (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES founders(id),
  title TEXT NOT NULL,
  description TEXT,
  access_token TEXT UNIQUE NOT NULL,
  decision_ids TEXT,                   -- JSON: decision_id[] to share
  expires_at DATETIME,
  view_count INTEGER DEFAULT 0,
  last_viewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deal_rooms_product ON deal_rooms(product_id);
CREATE INDEX IF NOT EXISTS idx_deal_rooms_token ON deal_rooms(access_token);
