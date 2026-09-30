-- =============================================================================
-- 372 — "NOT NOW."
--
-- Mission Control (30 September 2026). Needs you is one list of everything that
-- waits on the owner (services/needs-you/queue.ts). He may put an item off —
-- until tomorrow at the latest, and never what a buyer is owed or the charter's
-- last days. One row per "not now", kept; it simply lapses when its time comes.
-- `item_key` names the item as the queue does ('act:<id>', 'mail:<id>', ...).
-- =============================================================================

CREATE TABLE IF NOT EXISTS needs_you_snoozes (
  id         TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  item_key   TEXT NOT NULL,
  until      TEXT NOT NULL,
  said_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_needs_you_snoozes_founder ON needs_you_snoozes(founder_id, until);

CREATE TRIGGER IF NOT EXISTS needs_you_snooze_is_kept
BEFORE UPDATE ON needs_you_snoozes
BEGIN
  SELECT RAISE(ABORT, 'needs_you_snooze: kept as it was said');
END;
