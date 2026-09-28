-- =============================================================================
-- 360 — THE OWNER'S OWN MINUTES ON A TEST, AS HE ENTERED THEM.
--
-- Roadmap D6. Proof 3 asks what a findable listing cost him in his own time,
-- and nothing recorded it. Entered by him, optional, and a day with no entry
-- is unknown rather than zero (`owner-minutes.ts`).
--
-- Kept as entered. A mistaken entry is withdrawn — `withdrawn_at` set once —
-- and stays on record; nothing else about a row ever changes.
-- =============================================================================

CREATE TABLE owner_minutes (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  on_day        TEXT NOT NULL CHECK (on_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  minutes       INTEGER NOT NULL CHECK (typeof(minutes) = 'integer' AND minutes BETWEEN 1 AND 1440),
  what          TEXT CHECK (what IS NULL OR length(what) <= 500),
  entered_at    TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at  TEXT
);

CREATE INDEX owner_minutes_by_test ON owner_minutes (experiment_id, on_day);

-- Only the person whose test it is: the table refuses anybody else's entry,
-- whatever the caller says.
CREATE TRIGGER owner_minutes_only_his_own_test
BEFORE INSERT ON owner_minutes
WHEN NEW.founder_id IS NOT (SELECT founder_id FROM venture_experiments WHERE id = NEW.experiment_id)
BEGIN
  SELECT RAISE(ABORT, 'owner_minutes:not_his_test');
END;

CREATE TRIGGER owner_minutes_entered_is_entered
BEFORE UPDATE ON owner_minutes
WHEN NEW.id IS NOT OLD.id OR NEW.founder_id IS NOT OLD.founder_id OR NEW.experiment_id IS NOT OLD.experiment_id
  OR NEW.on_day IS NOT OLD.on_day OR NEW.minutes IS NOT OLD.minutes OR NEW.what IS NOT OLD.what
  OR NEW.entered_at IS NOT OLD.entered_at
  OR OLD.withdrawn_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'owner_minutes:entered_is_entered');
END;
