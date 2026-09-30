-- =============================================================================
-- 370 — WHAT THE OWNER SAID, AND WHAT FOUNDRY UNDERSTOOD.
--
-- Mission Control (30 September 2026). Every sentence the composer takes is
-- compiled into one proposal (services/intent/compile.ts) and shown before
-- anything binds. Until now nothing kept the reading once the page closed, so
-- nobody could say how often Foundry understood him, what it failed to place,
-- or whether a confirmation matched what was shown. One row per sentence
-- shown: his words verbatim, what they were understood as, the hash of that
-- reading, and — once — how it ended. The reading is sealed; only the outcome
-- may be written, and only once.
-- =============================================================================

CREATE TABLE IF NOT EXISTS owner_intents (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  said           TEXT NOT NULL,
  scope          TEXT NOT NULL DEFAULT 'none',
  kind           TEXT NOT NULL CHECK (kind IN ('question','mission','steer','authority','housekeeping','jump','clarify','unplaceable')),
  understood_as  TEXT NOT NULL,
  touches_authority INTEGER NOT NULL DEFAULT 0 CHECK (touches_authority IN (0,1)),
  reading_hash   TEXT NOT NULL,
  shown_at       TEXT NOT NULL DEFAULT (datetime('now')),
  outcome        TEXT CHECK (outcome IS NULL OR outcome IN ('confirmed','answered','went')),
  outcome_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_owner_intents_founder ON owner_intents(founder_id, shown_at);

CREATE TRIGGER IF NOT EXISTS owner_intent_reading_is_sealed
BEFORE UPDATE ON owner_intents
WHEN NEW.founder_id IS NOT OLD.founder_id OR NEW.said IS NOT OLD.said OR NEW.scope IS NOT OLD.scope
  OR NEW.kind IS NOT OLD.kind OR NEW.understood_as IS NOT OLD.understood_as
  OR NEW.touches_authority IS NOT OLD.touches_authority OR NEW.reading_hash IS NOT OLD.reading_hash
  OR NEW.shown_at IS NOT OLD.shown_at OR OLD.outcome IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'owner_intent: the reading is sealed and its outcome is written once');
END;
