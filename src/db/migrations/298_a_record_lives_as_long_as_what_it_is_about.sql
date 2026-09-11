-- =============================================================================
-- FOUNDRY — the withdrawal record lives exactly as long as the test it is about
--
-- Migration 297 gave `owner_decision_reversals` an unconditional DELETE guard,
-- which made it the one table in the schema that erasure could not step
-- through. The canonical erasure plan classifies every table and the gate that
-- proves it went red, correctly: a row nobody can delete is a row that survives
-- an account erasure whether or not anybody decided it should.
--
-- The rule it should have had is narrower and truer. This record exists to say
-- what the owner decided and unmade about one experiment. While that experiment
-- exists the record may not be deleted — that is the whole point of writing it
-- before the decision is cleared. Once the experiment itself is gone, the record
-- has nothing left to be about, and erasure removes it with everything else.
-- =============================================================================

DROP TRIGGER owner_decision_reversal_no_delete;
CREATE TRIGGER owner_decision_reversal_no_delete
BEFORE DELETE ON owner_decision_reversals
BEGIN
  SELECT RAISE(ABORT,'owner_decision_reversal:immutable')
  WHERE EXISTS (SELECT 1 FROM venture_experiments e WHERE e.id = OLD.subject_id);
END;
