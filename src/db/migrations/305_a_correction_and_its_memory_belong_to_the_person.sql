-- =============================================================================
-- FOUNDRY — a correction and its memory belong to the person whose test it was
--
-- Migration 304 added two tables and left both outside the erasure. The
-- classification test caught `recipient_stratum_history` sitting in no bucket
-- at all, and the leak test caught `recipient_stratum_corrections.founder_id`
-- surviving an erasure that claimed to have completed. This is the same
-- oversight as migration 302, made again three migrations later, and the lesson
-- is the one the gate keeps teaching: a table is not finished when its own
-- behaviour is right.
--
-- The history has no founder of its own, only an experiment it is about. It
-- gets the column directly for the same reason the marks did: every other
-- founder-scoped child in this schema carries one, and the odd one out is the
-- one somebody gets wrong later.
--
-- AND THE DELETE GUARD LEARNS TO STAND ASIDE FOR AN ERASURE. A recipient that
-- was authorised or written to may not be deleted, because deleting it is how
-- a stratum would be laundered. But an erasure is not a relabelling: it removes
-- the experiment and everything about it, and a guard that refuses would leave
-- a person's data in place while the institution reported the erasure done.
-- So the guard applies while the experiment still stands, and lifts once it is
-- gone — the pattern migration 298 used for the same reason.
-- =============================================================================

ALTER TABLE recipient_stratum_history ADD COLUMN founder_id TEXT REFERENCES founders(id);

UPDATE recipient_stratum_history
   SET founder_id = (SELECT e.founder_id FROM venture_experiments e WHERE e.id = experiment_id)
 WHERE founder_id IS NULL;

DROP TRIGGER recipient_stratum_remembered;
CREATE TRIGGER recipient_stratum_remembered
AFTER UPDATE OF evidence_stratum ON experiment_recipients
WHEN NEW.evidence_stratum IS NOT NULL AND OLD.evidence_stratum IS NULL
BEGIN
  INSERT OR IGNORE INTO recipient_stratum_history (experiment_id, counterparty, stratum, founder_id)
  VALUES (NEW.experiment_id, trim(lower(NEW.counterparty_ref)), NEW.evidence_stratum, NEW.founder_id);
END;

DROP TRIGGER experiment_recipient_no_delete_after_consequence;
CREATE TRIGGER experiment_recipient_no_delete_after_consequence
BEFORE DELETE ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:something_happened_to_this_one')
  WHERE EXISTS (SELECT 1 FROM venture_experiments e WHERE e.id = OLD.experiment_id)
    AND (OLD.authorised_act_id IS NOT NULL
      OR OLD.review_status <> 'pending'
      OR EXISTS (SELECT 1 FROM outbound_actions a WHERE a.recipient_id = OLD.id));
END;
