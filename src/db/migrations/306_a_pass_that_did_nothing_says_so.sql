-- =============================================================================
-- FOUNDRY — a pass that did nothing says so
--
-- The owner authorised Experiment 001. The hourly hand then ran, found it could
-- not create a payment link because the governed Stripe door had no registered
-- handler, pushed a sentence into a report object, and recorded the run as a
-- SUCCESS. It did that every hour. Nothing reached the twenty-one businesses,
-- nothing reached the owner, and the only place the truth existed was an
-- exceptions array that no surface reads.
--
-- The boundary held perfectly. What failed was the institution's account of
-- itself: "ran without throwing" was being reported as "did what it was for".
--
-- SO A RUN NOW HAS A STATE, AND THE STATE IS A FACT ABOUT PROGRESS, not about
-- whether an exception escaped:
--
--   success        the pass moved the authorised act forward
--   noop_expected  there was legitimately nothing to do, and that is correct
--   partial        some of the intended work happened and some did not
--   degraded       the work happened, but something needed for it is unhealthy
--   blocked        an authorised act could not proceed: a dependency is down,
--                  and no amount of waiting inside this pass would fix it
--   failed         the pass broke
--
-- BLOCKED IS THE ONE THAT WAS MISSING, and it is the one this outage needed.
-- An authorised experiment that cannot place its offer is not idling and is not
-- succeeding quietly. It is stopped, on something the institution must repair,
-- and the owner is owed that sentence rather than an empty page.
--
-- One row per experiment, overwritten each pass: this is a live reading, not a
-- history. What happened stays in the outbound and effect records, which are
-- append-only and are not what this replaces.
-- =============================================================================

CREATE TABLE experiment_run_state (
  experiment_id  TEXT PRIMARY KEY REFERENCES venture_experiments(id),
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  state          TEXT NOT NULL CHECK (state IN
                   ('success','noop_expected','partial','degraded','blocked','failed')),
  -- What the institution was trying to do, in the owner's words.
  attempting     TEXT NOT NULL,
  -- Why it did not happen. Required whenever the state is not a clean one: a
  -- blocked run with no reason is the silent failure wearing a new label.
  because        TEXT,
  -- The dependency that is down, named so a person can tell whether it is
  -- theirs to fix or the institution's.
  dependency     TEXT,
  -- Whether the owner has to do anything. Almost always no: an internal
  -- dependency is the institution's to repair, and saying otherwise turns a
  -- bug into homework.
  owner_action   TEXT,
  progressed     INTEGER NOT NULL DEFAULT 0,
  checked_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER experiment_run_state_says_why
BEFORE INSERT ON experiment_run_state
BEGIN
  SELECT RAISE(ABORT,'experiment_run_state:a_bad_state_needs_a_reason')
    WHERE NEW.state IN ('blocked','failed','partial','degraded')
      AND trim(coalesce(NEW.because,'')) = '';
END;

CREATE TRIGGER experiment_run_state_says_why_on_update
BEFORE UPDATE ON experiment_run_state
BEGIN
  SELECT RAISE(ABORT,'experiment_run_state:a_bad_state_needs_a_reason')
    WHERE NEW.state IN ('blocked','failed','partial','degraded')
      AND trim(coalesce(NEW.because,'')) = '';
END;
