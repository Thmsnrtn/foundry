-- =============================================================================
-- A REPAIR DOES NOT ERASE THE HISTORY OF THE FAILURE.
--
-- `experiment_paths.broken_since` was the record that a test's window had been
-- measured through a broken instrument, and the morning the path came back it
-- was set to NULL. The institution then held no evidence that anything had
-- ever been wrong — the exact shape of the failure this campaign is about,
-- committed by the machinery built to prevent it. A record whose only state is
-- "how things are now" cannot answer "how were things while the world was
-- asked", and that is the only question that decides what a result establishes.
--
-- So an interval is opened when a path is first found not working and CLOSED
-- when it comes back. Closing is not deleting. `broken_since` keeps its job as
-- the open interval's start, which is what the trigger on `experiment_paths`
-- reads; this table keeps every interval, open and closed, for good.
--
-- APPEND-ONLY, LIKE `public_channel_days` AND `cloudflare_mutations`: a later
-- reading may add what it found, never improve what an earlier one found.
-- =============================================================================

CREATE TABLE experiment_path_outages (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  -- Carried as its siblings carry it, so the erasure walks it by founder.
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  kind          TEXT NOT NULL REFERENCES experiment_path_kinds(kind),
  -- When the path was first found not working, and in the owner's words what
  -- was wrong. Neither is ever rewritten.
  broke_at      TEXT NOT NULL,
  broke_detail  TEXT NOT NULL,
  -- When a working reading closed it, and what that reading said. Null while
  -- the interval is still open.
  mended_at     TEXT,
  mended_detail TEXT
);

CREATE INDEX idx_experiment_path_outages ON experiment_path_outages(experiment_id, kind, broke_at);
-- The one open interval per path, which is what a close looks for.
CREATE INDEX idx_experiment_path_outages_open ON experiment_path_outages(experiment_id, kind, mended_at);

CREATE TRIGGER experiment_path_outage_is_not_rewritten
BEFORE UPDATE ON experiment_path_outages
BEGIN
  -- WHAT WAS FOUND IS WHAT WAS FOUND. Only the mending may be added.
  SELECT RAISE(ABORT,'path_outage:immutable')
    WHERE NEW.id <> OLD.id OR NEW.experiment_id <> OLD.experiment_id
       OR NEW.founder_id <> OLD.founder_id OR NEW.kind <> OLD.kind
       OR NEW.broke_at <> OLD.broke_at OR NEW.broke_detail <> OLD.broke_detail;
  -- A MENDING IS NEVER UN-SAID, and never moved once said.
  SELECT RAISE(ABORT,'path_outage:mending_is_kept')
    WHERE OLD.mended_at IS NOT NULL
      AND (NEW.mended_at IS NULL OR NEW.mended_at <> OLD.mended_at);
  -- AND NEVER PREDATES THE BREAK, which would make the interval a nonsense.
  SELECT RAISE(ABORT,'path_outage:mended_before_broken')
    WHERE NEW.mended_at IS NOT NULL AND NEW.mended_at < NEW.broke_at;
END;

-- AND NEVER DELETED, WHICH IS HOW THE IMMUTABILITY ABOVE MEANS ANYTHING:
-- without this, "rewrite what was found" is a delete and an insert.
--
-- The one exception is the person's own erasure, the same exception
-- `cloudflare_mutations` carries and for the same reason — a record kept
-- against a repair is still their record, and a right to be forgotten is not
-- an attempt to improve history.
CREATE TRIGGER experiment_path_outage_is_never_deleted
BEFORE DELETE ON experiment_path_outages
BEGIN
  SELECT RAISE(ABORT,'path_outage:never_deleted') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

CREATE TRIGGER experiment_path_outage_says_what_was_wrong
BEFORE INSERT ON experiment_path_outages
BEGIN
  SELECT RAISE(ABORT,'path_outage:unsaid') WHERE trim(NEW.broke_detail) = '';
  SELECT RAISE(ABORT,'path_outage:mended_before_broken')
    WHERE NEW.mended_at IS NOT NULL AND NEW.mended_at < NEW.broke_at;
END;
