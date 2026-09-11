-- =============================================================================
-- FOUNDRY — a correction is a record, not a loophole
--
-- While diagnosing why the seal had written no strata at all, the institution
-- set evidence_stratum on a real candidate row to see whether the write path
-- worked, intending to put it back. The guard refused to put it back, which is
-- exactly what that guard is for: if a stratum could be revised after the fact,
-- whichever group happened to pay could be relabelled afterwards as the one
-- always expected to, and the only comparison the split exists for would be
-- unfalsifiable.
--
-- So the value was wrong and could not be corrected, and the two obvious ways
-- out are both worse than the problem. Relaxing the guard destroys the
-- property. Deleting the row and re-inserting it launders the same relabelling
-- through a side door and leaves no trace that anything happened.
--
-- THE NARROW PATH: a correction is possible only where a CORRECTION RECORD
-- exists saying what was wrong, what is right, who did it, when, why, and --
-- the part that matters -- attesting that nothing happened while the wrong
-- value stood. No authorisation, no message, no customer, no payment, no
-- evidence. A stratum that never influenced anything is a clerical error. One
-- that did is a finding, and this will not touch it.
--
-- NORMAL RUNTIME STILL REFUSES. Without a matching unconsumed correction row
-- the guard behaves exactly as before, and the tests pin that.
-- =============================================================================

CREATE TABLE recipient_stratum_corrections (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  recipient_id   TEXT NOT NULL REFERENCES experiment_recipients(id),
  -- What the row said, and what it should have said.
  mistaken       TEXT NOT NULL CHECK (mistaken IN ('public_work_observed','commercial_institutional_capable')),
  correct        TEXT NOT NULL CHECK (correct  IN ('public_work_observed','commercial_institutional_capable')),
  -- How the wrong value came to be there. Only one kind of mistake is
  -- correctable: one the institution made to itself.
  origin         TEXT NOT NULL CHECK (origin IN ('institution_diagnostic')),
  because        TEXT NOT NULL,
  corrected_by   TEXT NOT NULL,
  corrected_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- The attestation, recorded rather than asserted in a comment. Every one of
  -- these must be true, and the guard below re-checks the ones it can see for
  -- itself rather than believing the row.
  nothing_authorised   INTEGER NOT NULL CHECK (nothing_authorised = 1),
  nothing_sent         INTEGER NOT NULL CHECK (nothing_sent = 1),
  nobody_replied       INTEGER NOT NULL CHECK (nobody_replied = 1),
  nothing_paid         INTEGER NOT NULL CHECK (nothing_paid = 1),
  no_evidence_rests_on_it INTEGER NOT NULL CHECK (no_evidence_rests_on_it = 1),
  -- One correction, once. Set when the update it permits actually happens.
  consumed_at    TEXT,
  UNIQUE(recipient_id, mistaken, correct)
);

CREATE TRIGGER recipient_stratum_correction_immutable
BEFORE UPDATE ON recipient_stratum_corrections
BEGIN
  -- Only the consumption stamp may ever be written, and only once.
  SELECT RAISE(ABORT,'recipient_stratum_correction:immutable')
    WHERE NEW.id IS NOT OLD.id OR NEW.recipient_id IS NOT OLD.recipient_id
       OR NEW.mistaken IS NOT OLD.mistaken OR NEW.correct IS NOT OLD.correct
       OR NEW.because IS NOT OLD.because OR NEW.corrected_by IS NOT OLD.corrected_by
       OR NEW.corrected_at IS NOT OLD.corrected_at OR NEW.origin IS NOT OLD.origin;
  SELECT RAISE(ABORT,'recipient_stratum_correction:already_consumed')
    WHERE OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NOT OLD.consumed_at;
END;

CREATE TRIGGER recipient_stratum_correction_no_delete
BEFORE DELETE ON recipient_stratum_corrections
BEGIN
  SELECT RAISE(ABORT,'recipient_stratum_correction:is_the_record')
  WHERE EXISTS (SELECT 1 FROM experiment_recipients r WHERE r.id = OLD.recipient_id);
END;

-- WHAT A BUSINESS WAS EVER PUT IN, surviving the row itself.
--
-- Deleting a recipient and inserting it again would otherwise be a way to
-- relabel a stratum with no record that anything changed. The history is keyed
-- by the business rather than the row, so a new row for the same business in
-- the same experiment meets what the old one was told.
CREATE TABLE recipient_stratum_history (
  experiment_id   TEXT NOT NULL,
  counterparty    TEXT NOT NULL,
  stratum         TEXT NOT NULL,
  first_set_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (experiment_id, counterparty)
);

CREATE TRIGGER recipient_stratum_remembered
AFTER UPDATE OF evidence_stratum ON experiment_recipients
WHEN NEW.evidence_stratum IS NOT NULL AND OLD.evidence_stratum IS NULL
BEGIN
  INSERT OR IGNORE INTO recipient_stratum_history (experiment_id, counterparty, stratum)
  VALUES (NEW.experiment_id, trim(lower(NEW.counterparty_ref)), NEW.evidence_stratum);
END;

-- A correction updates the memory too, or the memory would refuse the very
-- change the correction record permits.
CREATE TRIGGER recipient_stratum_corrected_in_memory
AFTER UPDATE OF evidence_stratum ON experiment_recipients
WHEN NEW.evidence_stratum IS NOT NULL AND OLD.evidence_stratum IS NOT NULL
     AND NEW.evidence_stratum IS NOT OLD.evidence_stratum
BEGIN
  UPDATE recipient_stratum_history SET stratum = NEW.evidence_stratum
   WHERE experiment_id = NEW.experiment_id AND counterparty = trim(lower(NEW.counterparty_ref));
END;

DROP TRIGGER experiment_recipient_stratum_guard;
CREATE TRIGGER experiment_recipient_stratum_guard
BEFORE UPDATE OF evidence_stratum ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:stratum_needs_a_qualification')
    WHERE NEW.evidence_stratum IS NOT NULL AND NEW.qualified_at IS NULL;

  -- THE RULE, UNCHANGED: a stratum stands once set. The only thing that moves
  -- it is a correction record that already exists, names this exact change,
  -- has not been used, and attests that nothing happened under the wrong value.
  SELECT RAISE(ABORT,'experiment_recipient:stratum_stands')
    WHERE OLD.evidence_stratum IS NOT NULL
      AND NEW.evidence_stratum IS NOT OLD.evidence_stratum
      AND NOT EXISTS (
        SELECT 1 FROM recipient_stratum_corrections c
         WHERE c.recipient_id = OLD.id AND c.consumed_at IS NULL
           AND c.mistaken = OLD.evidence_stratum AND c.correct = NEW.evidence_stratum);

  -- AND THE ATTESTATION IS RE-CHECKED, not believed. A correction may not be
  -- used on a row that has been authorised or written to, whatever its row says.
  SELECT RAISE(ABORT,'experiment_recipient:stratum_correction_after_consequence')
    WHERE OLD.evidence_stratum IS NOT NULL
      AND NEW.evidence_stratum IS NOT OLD.evidence_stratum
      AND (OLD.authorised_act_id IS NOT NULL
        OR OLD.review_status <> 'pending'
        OR EXISTS (SELECT 1 FROM outbound_actions a WHERE a.recipient_id = OLD.id));

  -- A BUSINESS CANNOT BE RELABELLED BY BEING DELETED AND WRITTEN AGAIN. If this
  -- experiment has already recorded a stratum for this business, a fresh row
  -- for it meets the same answer.
  SELECT RAISE(ABORT,'experiment_recipient:stratum_was_already_decided_for_this_business')
    WHERE NEW.evidence_stratum IS NOT NULL AND OLD.evidence_stratum IS NULL
      AND EXISTS (
        SELECT 1 FROM recipient_stratum_history h
         WHERE h.experiment_id = NEW.experiment_id
           AND h.counterparty = trim(lower(NEW.counterparty_ref))
           AND h.stratum <> NEW.evidence_stratum);
END;

-- AND A RECIPIENT THAT ANYTHING HAPPENED TO IS NOT DELETABLE AT ALL.
--
-- The delete-and-reinsert loophole is closed at both ends: the history above
-- stops the relabelling, and this stops the deletion that would attempt it.
-- A candidate row nobody ever acted on remains removable, which is what makes
-- a stale pre-authority row correctable at all.
CREATE TRIGGER experiment_recipient_no_delete_after_consequence
BEFORE DELETE ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:something_happened_to_this_one')
    WHERE OLD.authorised_act_id IS NOT NULL
       OR OLD.review_status <> 'pending'
       OR EXISTS (SELECT 1 FROM outbound_actions a WHERE a.recipient_id = OLD.id);
END;
