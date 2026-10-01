-- =============================================================================
-- 374 — WHAT AN HOUR OF THE OWNER'S IS WORTH, AND MINUTES THAT ARE NOT A TEST'S.
--
-- Roadmap 2027 R6 (OBJECTIVE §2: hold an asset while v > λ·a).
--
-- λ, the owner's value per minute, was never stated, and `a`, the recurring
-- minutes an asset asks, could not be recorded: every minute had to belong to
-- a test. So the hold rule could not be computed for anything, including
-- Foundry itself.
--
-- 1. `owner_hour_values`: a range the owner states, low and high, in cents an
--    hour, with where the number came from. Append-only: a new statement
--    supersedes by being newer, and what the owner believed in March stays
--    explicable. A range, because nobody knows this to the dollar, and a point
--    estimate would pretend to.
--
-- 2. `owner_minutes` rebuilt so a minute can belong to a test, to an asset,
--    or to Foundry itself (neither), never to both. The same guards: only the
--    person whose test or asset it is can enter time on it, and an entry is
--    kept as entered, withdrawn at most once.
-- =============================================================================

CREATE TABLE owner_hour_values (
  id                 TEXT PRIMARY KEY,
  founder_id         TEXT NOT NULL REFERENCES founders(id),
  low_cents_per_hour INTEGER NOT NULL CHECK (typeof(low_cents_per_hour) = 'integer' AND low_cents_per_hour BETWEEN 0 AND 10000000),
  high_cents_per_hour INTEGER NOT NULL CHECK (typeof(high_cents_per_hour) = 'integer' AND high_cents_per_hour BETWEEN 0 AND 10000000),
  source             TEXT NOT NULL CHECK (trim(source) <> '' AND length(source) <= 300),
  said_by            TEXT NOT NULL CHECK (said_by = 'founder:' || founder_id),
  said_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (low_cents_per_hour <= high_cents_per_hour)
);

CREATE INDEX owner_hour_values_by_owner ON owner_hour_values (founder_id, said_at);

CREATE TRIGGER owner_hour_values_said_is_said
BEFORE UPDATE ON owner_hour_values
BEGIN
  SELECT RAISE(ABORT, 'owner_hour_values:said_is_said');
END;

CREATE TABLE owner_minutes_new (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  experiment_id TEXT REFERENCES venture_experiments(id),
  product_id    TEXT REFERENCES products(id),
  on_day        TEXT NOT NULL CHECK (on_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  minutes       INTEGER NOT NULL CHECK (typeof(minutes) = 'integer' AND minutes BETWEEN 1 AND 1440),
  what          TEXT CHECK (what IS NULL OR length(what) <= 500),
  entered_at    TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at  TEXT,
  CHECK (experiment_id IS NULL OR product_id IS NULL)
);

INSERT INTO owner_minutes_new (id, founder_id, experiment_id, product_id, on_day, minutes, what, entered_at, withdrawn_at)
  SELECT id, founder_id, experiment_id, NULL, on_day, minutes, what, entered_at, withdrawn_at FROM owner_minutes;

DROP TABLE owner_minutes;
ALTER TABLE owner_minutes_new RENAME TO owner_minutes;

CREATE INDEX owner_minutes_by_test ON owner_minutes (experiment_id, on_day);
CREATE INDEX owner_minutes_by_owner ON owner_minutes (founder_id, entered_at);

-- Only the person whose test it is: the table refuses anybody else's entry,
-- whatever the caller says.
CREATE TRIGGER owner_minutes_only_his_own_test
BEFORE INSERT ON owner_minutes
WHEN NEW.experiment_id IS NOT NULL
  AND NEW.founder_id IS NOT (SELECT founder_id FROM venture_experiments WHERE id = NEW.experiment_id)
BEGIN
  SELECT RAISE(ABORT, 'owner_minutes:not_his_test');
END;

-- And the person whose asset it is.
CREATE TRIGGER owner_minutes_only_their_own_asset
BEFORE INSERT ON owner_minutes
WHEN NEW.product_id IS NOT NULL
  AND NEW.founder_id IS NOT (SELECT owner_id FROM products WHERE id = NEW.product_id)
BEGIN
  SELECT RAISE(ABORT, 'owner_minutes:not_their_asset');
END;

CREATE TRIGGER owner_minutes_entered_is_entered
BEFORE UPDATE ON owner_minutes
WHEN NEW.id IS NOT OLD.id OR NEW.founder_id IS NOT OLD.founder_id OR NEW.experiment_id IS NOT OLD.experiment_id
  OR NEW.product_id IS NOT OLD.product_id
  OR NEW.on_day IS NOT OLD.on_day OR NEW.minutes IS NOT OLD.minutes OR NEW.what IS NOT OLD.what
  OR NEW.entered_at IS NOT OLD.entered_at
  OR OLD.withdrawn_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'owner_minutes:entered_is_entered');
END;
