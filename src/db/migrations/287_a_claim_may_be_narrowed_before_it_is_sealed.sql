-- =============================================================================
-- A CLAIM MAY BE NARROWED BEFORE IT IS SEALED — AND ONLY WITH ITS OWN RECORD.
--
-- Migration 286 made the deliberation immutable after the owner decides, which
-- is the property that makes it evidence. It said nothing about the window
-- before that, and left a gap that looks harmless and is not: an unsealed
-- design could be rewritten silently, so a claim could be quietly widened after
-- being read and quietly narrowed after being doubted, with the row showing no
-- sign either happened.
--
-- The window itself is legitimate and worth keeping. A probe's stated claim
-- SHOULD be narrowed when it turns out to be broader than the chosen exchange
-- can establish — that is claim/evidence alignment, and doing it before the
-- world is asked is the only honest time to do it. What must not be possible is
-- doing it invisibly.
--
-- So: an amendment carries a reason, keeps the words it replaced, is refused
-- once sealed, and is stamped on the design itself, so a design that was
-- narrowed cannot afterwards be mistaken for one that was always this narrow.
-- =============================================================================

ALTER TABLE probe_designs ADD COLUMN amended_at TEXT;
ALTER TABLE probe_designs ADD COLUMN amended_because TEXT;

CREATE TABLE probe_design_amendments (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  -- Which sentence changed. A design field ('decides'), or one reading of a
  -- likely observation ('interpretation: Nobody pays inside seven days').
  field         TEXT NOT NULL,
  was           TEXT NOT NULL,
  reads_now     TEXT NOT NULL,
  because       TEXT NOT NULL,
  amended_by    TEXT NOT NULL,
  amended_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_probe_design_amendments ON probe_design_amendments(experiment_id, amended_at);

CREATE TRIGGER probe_design_amendment_guard
BEFORE INSERT ON probe_design_amendments
BEGIN
  SELECT RAISE(ABORT,'probe_design_amendment:incomplete')
    WHERE trim(NEW.field) = '' OR trim(NEW.was) = '' OR trim(NEW.reads_now) = ''
       OR trim(NEW.because) = '' OR trim(NEW.amended_by) = '';
  SELECT RAISE(ABORT,'probe_design_amendment:no_change') WHERE NEW.was = NEW.reads_now;
  SELECT RAISE(ABORT,'probe_design_amendment:no_design') WHERE NOT EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.founder_id = NEW.founder_id);
  -- THE SEAL IS THE END OF THE WINDOW. After the owner has decided, the reason
  -- for a change is always the same reason — the result — and no wording of it
  -- makes the amended claim evidence again.
  SELECT RAISE(ABORT,'probe_design_amendment:after_the_seal') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
END;

CREATE TRIGGER probe_design_amendment_append_only
BEFORE UPDATE ON probe_design_amendments
BEGIN
  SELECT RAISE(ABORT,'probe_design_amendment:append_only');
END;

-- Erasure is not a rewrite of history; it is a person leaving. Migration 224.
CREATE TRIGGER probe_design_amendment_erasable
BEFORE DELETE ON probe_design_amendments
BEGIN
  SELECT RAISE(ABORT,'probe_design_amendment:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

-- ─── The design itself now says whether it was narrowed ──────────────────────
DROP TRIGGER probe_design_sealed;
CREATE TRIGGER probe_design_sealed
BEFORE UPDATE ON probe_designs
BEGIN
  SELECT RAISE(ABORT,'probe_design:immutable')
    WHERE NEW.experiment_id IS NOT OLD.experiment_id OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.designed_by IS NOT OLD.designed_by OR NEW.designed_at IS NOT OLD.designed_at;
  -- Once sealed, the thinking is what it was. A design that could be edited
  -- after exposure would let every outcome be narrated as the expected one.
  SELECT RAISE(ABORT,'probe_design:is_sealed')
    WHERE OLD.sealed_at IS NOT NULL
      AND (NEW.decides IS NOT OLD.decides OR NEW.decides_because IS NOT OLD.decides_because
        OR NEW.exchange IS NOT OLD.exchange OR NEW.exchange_because IS NOT OLD.exchange_because
        OR NEW.can_prove IS NOT OLD.can_prove OR NEW.cannot_prove IS NOT OLD.cannot_prove
        OR NEW.rather_than_waiting IS NOT OLD.rather_than_waiting
        OR NEW.distribution IS NOT OLD.distribution OR NEW.if_it_succeeds IS NOT OLD.if_it_succeeds
        OR NEW.fulfilment_cap IS NOT OLD.fulfilment_cap
        OR NEW.recommendation IS NOT OLD.recommendation
        OR NEW.recommendation_because IS NOT OLD.recommendation_because);
  SELECT RAISE(ABORT,'probe_design:unsealed_once_sealed')
    WHERE OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS NULL;
  -- BEFORE THE SEAL, A CHANGE IS ALLOWED AND MUST SAY SO. Every content change
  -- stamps the design and carries a reason, so nothing can be rewritten in a
  -- way that leaves the row looking untouched.
  SELECT RAISE(ABORT,'probe_design:amendment_needs_a_reason')
    WHERE OLD.sealed_at IS NULL
      AND (NEW.decides IS NOT OLD.decides OR NEW.decides_because IS NOT OLD.decides_because
        OR NEW.exchange IS NOT OLD.exchange OR NEW.exchange_because IS NOT OLD.exchange_because
        OR NEW.can_prove IS NOT OLD.can_prove OR NEW.cannot_prove IS NOT OLD.cannot_prove
        OR NEW.rather_than_waiting IS NOT OLD.rather_than_waiting
        OR NEW.distribution IS NOT OLD.distribution OR NEW.if_it_succeeds IS NOT OLD.if_it_succeeds
        OR NEW.fulfilment_cap IS NOT OLD.fulfilment_cap
        OR NEW.recommendation IS NOT OLD.recommendation
        OR NEW.recommendation_because IS NOT OLD.recommendation_because)
      AND (NEW.amended_at IS OLD.amended_at OR trim(coalesce(NEW.amended_because,'')) = '');
  -- An amendment stamp without an amendment is a claim of care that did not
  -- happen; it is refused in the same breath as an amendment without a stamp.
  SELECT RAISE(ABORT,'probe_design:stamp_without_a_change')
    WHERE NEW.amended_at IS NOT OLD.amended_at
      AND NOT EXISTS (SELECT 1 FROM probe_design_amendments a WHERE a.experiment_id = NEW.experiment_id);
END;

CREATE TRIGGER probe_interpretation_amended
BEFORE UPDATE ON probe_interpretations
BEGIN
  -- The same window, for the readings. `probe_interpretation_sealed` already
  -- refuses after the seal; this refuses a silent change before it.
  SELECT RAISE(ABORT,'probe_interpretation:amendment_needs_a_reason')
    WHERE (NEW.observation IS NOT OLD.observation OR NEW.reading IS NOT OLD.reading
        OR NEW.distinguished_by IS NOT OLD.distinguished_by)
      AND NOT EXISTS (
        SELECT 1 FROM probe_design_amendments a
         WHERE a.experiment_id = NEW.experiment_id AND a.reads_now = NEW.reading);
END;
