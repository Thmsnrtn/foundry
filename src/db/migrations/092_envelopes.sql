-- =============================================================================
-- Migration 092: Envelopes (Hands Law / Constitution Law 10)
--
-- An envelope bounds HOW MUCH the hands may do per week without asking —
-- the complement to grants (which bound WHAT they may touch at all) and the
-- trust ladder (which bounds what the autopilot may DECIDE). This is how
-- humans delegate to humans: freedom inside a budget. Scope examples:
-- 'mcp:<server>' (calls/week through one connected server); later 'emails',
-- 'posts', 'prs'. Founder-set caps live in envelopes; consumption is counted
-- per ISO week in envelope_usage (insert-or-increment, race-safe on UNIQUE).
-- =============================================================================

CREATE TABLE IF NOT EXISTS envelopes (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  scope       TEXT NOT NULL,              -- e.g. 'mcp:my-crm'
  weekly_cap  INTEGER NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, scope)
);

CREATE TABLE IF NOT EXISTS envelope_usage (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  scope         TEXT NOT NULL,
  week_starting TEXT NOT NULL,            -- ISO date of the week's Monday
  used_count    INTEGER NOT NULL DEFAULT 0,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, scope, week_starting)
);

CREATE INDEX IF NOT EXISTS idx_envelope_usage_lookup
  ON envelope_usage(product_id, scope, week_starting);
