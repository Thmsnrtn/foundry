-- =============================================================================
-- A RECORD CAN CARRY A LATER FINDING, WITHOUT THE RECORD CHANGING
--
-- Experiment 001 closed having met none of its condition: nobody bought within
-- the seven days. That result stands and is not in question. What was found
-- afterwards is that the reply route for those messages was unrouted, so a
-- reply to them would not have arrived — which does not change the result and
-- does change what the result is evidence ABOUT. A recorded silence from people
-- who could not have been heard is not a recorded silence from people who chose
-- not to answer.
--
-- THE OWNER AUTHORISED A NARROW, CLEARLY DATED CLARIFICATION and no more: the
-- original prediction, settlement, receipts and historical record are preserved
-- exactly as they are, the experiment is not rewritten, and it is not presented
-- as having succeeded. So this is an ADDITIVE column beside the sealed copy,
-- never an edit to it.
--
-- WHY IT IS A COLUMN AND NOT A REWRITE, said once here because the temptation
-- is permanent: every cheaper option available was a lie. Editing
-- `public_outcome` would have made the correction invisible — a reader would
-- see only the current text and have no way to know it had ever said anything
-- else. Adding a sentence to the sealed copy would have broken the seal that
-- makes the record worth anything. A footnote with its own date says both
-- things at once: this is what was recorded, and this is what was found later.
--
-- THE THREE RULES BELOW ARE THE WHOLE OF THE SAFETY.
--   1. A clarification may only be written about a test that has ENDED. The
--      same rule `public_outcome` already lives under, for the same reason: a
--      finding about a test still running is a prediction wearing a date.
--   2. NO SEALED COLUMN MAY CHANGE IN THE SAME STATEMENT. Not "should not" —
--      the statement is refused. A clarification that arrived alongside a
--      quiet edit to the summary would be the exact thing the owner forbade,
--      and it would be indistinguishable from an honest one afterwards.
--   3. ONCE PUBLISHED, IT CANNOT BE SILENTLY CHANGED OR REMOVED. A footnote
--      that can be withdrawn without trace is not a correction; it is a draft
--      the public happened to see. Changing it requires the date to move with
--      it, so a reader can always tell that it did.
-- =============================================================================

ALTER TABLE public_experiments ADD COLUMN public_clarification TEXT;
ALTER TABLE public_experiments ADD COLUMN public_clarification_at TEXT;

DROP TRIGGER IF EXISTS public_experiment_identity_is_durable;

CREATE TRIGGER public_experiment_identity_is_durable
BEFORE UPDATE ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:identity_is_durable')
    WHERE NEW.experiment_id IS NOT OLD.experiment_id OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.number IS NOT OLD.number OR NEW.slug IS NOT OLD.slug
       OR NEW.supersedes_experiment_id IS NOT OLD.supersedes_experiment_id;
  -- A public outcome is written about a test that has ended: settled, stopped
  -- or declined. Writing one earlier would be a prediction dressed as a result.
  SELECT RAISE(ABORT,'public_experiment:outcome_needs_an_ended_test')
    WHERE NEW.public_outcome IS NOT NULL AND NEW.public_outcome IS NOT OLD.public_outcome AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id
        AND (e.ran_at IS NOT NULL OR e.decision = 'declined' OR e.validity = 'invalid'
             OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL)));

  -- A LATER FINDING IS ABOUT A TEST THAT HAS ENDED, for the same reason.
  SELECT RAISE(ABORT,'public_experiment:clarification_needs_an_ended_test')
    WHERE NEW.public_clarification IS NOT NULL
      AND NEW.public_clarification IS NOT OLD.public_clarification AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id
        AND (e.ran_at IS NOT NULL OR e.decision = 'declined' OR e.validity = 'invalid'
             OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL)));

  -- IT CARRIES ITS OWN DATE OR IT IS NOT A CLARIFICATION. "Found later" with no
  -- "later" is a sentence a reader cannot place against the record.
  SELECT RAISE(ABORT,'public_experiment:clarification_needs_a_date')
    WHERE (NEW.public_clarification IS NULL) <> (NEW.public_clarification_at IS NULL);
  SELECT RAISE(ABORT,'public_experiment:clarification_is_empty')
    WHERE NEW.public_clarification IS NOT NULL AND trim(NEW.public_clarification) = '';

  -- AND NOTHING SEALED MOVES IN THE SAME STATEMENT. The whole authorisation is
  -- that the record stays as it is; a write that changed both at once could
  -- never be told apart from one that had not.
  SELECT RAISE(ABORT,'public_experiment:a_clarification_does_not_edit_the_record')
    WHERE NEW.public_clarification IS NOT OLD.public_clarification
      AND (NEW.public_title IS NOT OLD.public_title
        OR NEW.public_summary IS NOT OLD.public_summary
        OR NEW.public_who IS NOT OLD.public_who
        OR NEW.public_what IS NOT OLD.public_what
        OR NEW.public_limits IS NOT OLD.public_limits
        OR NEW.public_sources IS NOT OLD.public_sources
        OR NEW.public_selection IS NOT OLD.public_selection
        OR NEW.public_note IS NOT OLD.public_note
        OR NEW.public_outcome IS NOT OLD.public_outcome);

  -- ONCE IT IS PUBLISHED IT CANNOT BE WITHDRAWN, and it cannot be reworded
  -- while keeping its date. A footnote that can quietly disappear is a draft
  -- the public happened to see.
  SELECT RAISE(ABORT,'public_experiment:a_clarification_is_not_withdrawn')
    WHERE OLD.public_clarification IS NOT NULL AND NEW.public_clarification IS NULL;
  SELECT RAISE(ABORT,'public_experiment:a_reworded_clarification_is_a_new_one')
    WHERE OLD.public_clarification IS NOT NULL
      AND NEW.public_clarification IS NOT OLD.public_clarification
      AND NEW.public_clarification_at IS OLD.public_clarification_at;
END;
