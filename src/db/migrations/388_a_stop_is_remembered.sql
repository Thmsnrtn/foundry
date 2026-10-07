-- =============================================================================
-- A STOP IS REMEMBERED AFTER THE RESUME (remediation 1.3, 6 October 2026).
--
-- While the estate is paused, the reason, who and since when are held on
-- `public_workshop.economic_pause_*`, and resuming sets all three to NULL.
-- `stopEverything` wrote nothing of its own. So once he resumed, nothing
-- anywhere said the estate had ever been stopped, by whom, for how long, or
-- what went unwritten meanwhile — the simulation campaign's F-PANIC-2.
--
-- One row per act, written by the act itself: Stop everything, a pause of new
-- activity on its own, and the resume that ends either. A resume carries when
-- the pause began, how long it lasted, and how many approved businesses were
-- still unwritten when it ended. What the owner did is kept as it was: no row
-- is ever changed. Erasure of his account still deletes them, as it does
-- `mission_events`.
--
-- `audit_log` was the obvious home and is not one: it is per company (a Stop is
-- estate-wide, and an estate may have no company yet), it is pruned after 180
-- days by `maintenance/retention.ts`, and nothing stops a row being changed.
-- =============================================================================
CREATE TABLE IF NOT EXISTS estate_pause_events (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  kind           TEXT NOT NULL CHECK (kind IN ('stopped_everything', 'paused', 'resumed')),
  principal      TEXT NOT NULL,
  -- Stop and pause: the reason given. A resume carries the reason it ended.
  reason         TEXT,
  -- Stop: what it stopped, in words.
  detail         TEXT,
  -- Resume only: when the pause it ended began, how long it lasted, and how
  -- many approved businesses were still unwritten when it ended.
  paused_since   TEXT,
  paused_seconds INTEGER CHECK (paused_seconds IS NULL OR paused_seconds >= 0),
  unwritten      INTEGER CHECK (unwritten IS NULL OR unwritten >= 0),
  at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind = 'resumed' OR (reason IS NOT NULL AND paused_since IS NULL AND paused_seconds IS NULL AND unwritten IS NULL)),
  CHECK (kind <> 'resumed' OR (paused_since IS NOT NULL AND paused_seconds IS NOT NULL AND unwritten IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_estate_pause_events_founder ON estate_pause_events(founder_id, at);

CREATE TRIGGER IF NOT EXISTS estate_pause_events_are_kept
BEFORE UPDATE ON estate_pause_events
BEGIN
  SELECT RAISE(ABORT, 'estate_pause_events: what the owner did is kept as it was');
END;
