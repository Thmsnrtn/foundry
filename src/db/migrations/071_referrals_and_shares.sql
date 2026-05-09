-- =============================================================================
-- FOUNDRY — Referrals + Share-My-Briefing (Wave 3, action 21)
-- Two distribution mechanics:
--   1. referral_links: each founder gets a unique invite link; track
--      conversions back to the inviter for credit.
--   2. briefing_shares: founders can render a sanitized public snapshot
--      of their weekly outcome / signal score — Spotify-Wrapped-style
--      shareable evidence.
-- =============================================================================

CREATE TABLE IF NOT EXISTS referral_links (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,                -- short URL-safe token
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Counters maintained on conversion event:
  click_count INTEGER NOT NULL DEFAULT 0,
  signup_count INTEGER NOT NULL DEFAULT 0,
  paid_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_referral_code ON referral_links(code);

-- Per-conversion event log so we can debug attribution if claims diverge.
CREATE TABLE IF NOT EXISTS referral_conversions (
  id TEXT PRIMARY KEY,
  referral_link_id TEXT NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                 -- 'click' | 'signup' | 'paid'
  invited_founder_id TEXT,                  -- non-null for signup/paid events
  metadata_json TEXT,                       -- referrer URL, UTM, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ref_conversion_link
  ON referral_conversions(referral_link_id, created_at DESC);

CREATE TABLE IF NOT EXISTS briefing_shares (
  id TEXT PRIMARY KEY,
  share_code TEXT NOT NULL UNIQUE,          -- short URL-safe token
  founder_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  briefing_id TEXT NOT NULL,                -- snapshot reference
  expires_at TEXT NOT NULL,                 -- defaults to 30 days from create
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_briefing_share_code ON briefing_shares(share_code);
CREATE INDEX IF NOT EXISTS idx_briefing_share_founder
  ON briefing_shares(founder_id, created_at DESC);
