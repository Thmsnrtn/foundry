-- =============================================================================
-- Migration 094: Outreach suppression list (Hands Law H5)
--
-- The outreach department's first hard rail: an address on this list is never
-- contacted again, by any mode, at any trust level. Founder-append-only in
-- spirit — rows are added, not edited; removing someone from suppression is a
-- deliberate founder act.
-- =============================================================================

CREATE TABLE IF NOT EXISTS outreach_suppressions (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL,             -- 'unsubscribed' | 'bounced' | 'founder' | ...
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, email)
);

CREATE INDEX IF NOT EXISTS idx_outreach_suppressions
  ON outreach_suppressions(product_id, email);
