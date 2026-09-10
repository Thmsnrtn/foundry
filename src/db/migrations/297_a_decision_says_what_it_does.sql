-- =============================================================================
-- FOUNDRY — a decision says what it does, and one that did not can be undone
--
-- On 10 September the owner sat down to authorise one thing and pressed nine
-- buttons. They all read "Go ahead — nothing" or "Go ahead — $100.00", and the
-- only difference between approving an internal test and approving writing to
-- real businesses in his own name was the price string after the dash. Eight of
-- the nine were internal. The ninth was Experiment 001, which he had not meant
-- to approve at all, and which the generic control approved in a way that
-- created a $100 allowance with no end date, started a fourteen-day settlement
-- clock, and moved the experiment into a state where its own publication gate
-- refused it.
--
-- Nothing reached anybody: the hand only ever runs an experiment that carries an
-- approved, measurement-critical proposed act, and none was created. The
-- boundary held. The interface did not.
--
-- This migration adds the three things the repair needs from the database, and
-- nothing else.
--
-- 1. AN ALLOWANCE HAS AN END DATE, or says in words why it does not. A ceiling
--    that never expires is a standing authority nobody decided to grant.
--
-- 2. A DECISION CAN BE WITHDRAWN BY THE PERSON WHO MADE IT, on the record, while
--    nothing has yet happened under it. The record is written first and is
--    append-only, so the institution can always say both what he decided and
--    that he unmade it — never that he never decided.
--
-- 3. A TEST CAN BE RETIRED IN FAVOUR OF ANOTHER, keeping its lineage. Two tests
--    that ask the same question of the same population with the same evidence
--    are one test approved twice.
-- =============================================================================

-- ── 1 ── An allowance has a horizon ──────────────────────────────────────────

ALTER TABLE owner_allowances ADD COLUMN unbounded_because TEXT;

DROP TRIGGER owner_allowance_guard;
CREATE TRIGGER owner_allowance_guard
BEFORE INSERT ON owner_allowances
BEGIN
  SELECT RAISE(ABORT,'owner_allowance:incomplete')
    WHERE trim(NEW.purpose) = '' OR trim(NEW.statement) = '';
  SELECT RAISE(ABORT,'owner_allowance:cannot_arrive_withdrawn')
    WHERE NEW.withdrawn_at IS NOT NULL;
  -- ONE LIVE ALLOWANCE PER COMPANY. Two ceilings is no ceiling: something
  -- would have to decide which applies, and that decision is his.
  SELECT RAISE(ABORT,'owner_allowance:already_one')
    WHERE EXISTS (SELECT 1 FROM owner_allowances a
                   WHERE a.product_id = NEW.product_id AND a.withdrawn_at IS NULL);
  -- AND IT ENDS, OR SAYS WHY IT DOES NOT. The $100 the generic control wrote
  -- had no `until`, so a press meant to cover one test would have covered every
  -- later one. An allowance with no horizon is still allowed — some genuinely
  -- have none — but it has to be a sentence somebody wrote, not a null.
  SELECT RAISE(ABORT,'owner_allowance:needs_a_horizon')
    WHERE NEW.until IS NULL AND trim(coalesce(NEW.unbounded_because,'')) = '';
  SELECT RAISE(ABORT,'owner_allowance:horizon_is_one_or_the_other')
    WHERE NEW.until IS NOT NULL AND NEW.unbounded_because IS NOT NULL;
END;

DROP TRIGGER owner_allowance_withdraw_is_one_way;
CREATE TRIGGER owner_allowance_withdraw_is_one_way
BEFORE UPDATE ON owner_allowances
BEGIN
  SELECT RAISE(ABORT,'owner_allowance:already_withdrawn')
    WHERE OLD.withdrawn_at IS NOT NULL;
  SELECT RAISE(ABORT,'owner_allowance:withdraw_needs_reason')
    WHERE NEW.withdrawn_at IS NOT NULL AND trim(coalesce(NEW.withdraw_reason,'')) = '';
  -- The amount he granted is what he granted. Raising it in place would leave a
  -- record saying a larger ceiling was in force during a period when it was not.
  SELECT RAISE(ABORT,'owner_allowance:immutable')
    WHERE NEW.amount_cents IS NOT OLD.amount_cents
       OR NEW.statement IS NOT OLD.statement
       OR NEW.product_id IS NOT OLD.product_id
       OR NEW.set_at IS NOT OLD.set_at
       OR NEW.until IS NOT OLD.until
       OR NEW.unbounded_because IS NOT OLD.unbounded_because;
END;

-- ── 2 ── A decision he did not mean to make ──────────────────────────────────

CREATE TABLE owner_decision_reversals (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('venture_experiment')),
  subject_id TEXT NOT NULL,
  original_decision TEXT NOT NULL CHECK (original_decision IN ('approved','declined')),
  originally_decided_at TEXT NOT NULL,
  originally_decided_by TEXT NOT NULL,
  -- WHAT THE BUTTON SAID, in the words he actually read. The whole reason this
  -- table exists is that the label and the act came apart; a reversal that did
  -- not record the label would lose the only evidence of why.
  the_control_said TEXT NOT NULL,
  because TEXT NOT NULL,
  reversed_by TEXT NOT NULL,
  reversed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX owner_decision_reversals_subject
  ON owner_decision_reversals (subject_kind, subject_id);

CREATE TRIGGER owner_decision_reversal_guard
BEFORE INSERT ON owner_decision_reversals
BEGIN
  SELECT RAISE(ABORT,'owner_decision_reversal:incomplete')
    WHERE trim(NEW.because) = '' OR trim(NEW.the_control_said) = ''
       OR trim(NEW.reversed_by) = '';
  -- ONLY THE PERSON WHO DECIDED MAY UNDECIDE. An institution that could
  -- withdraw its owner's decisions would be deciding.
  SELECT RAISE(ABORT,'owner_decision_reversal:not_the_decider')
    WHERE NEW.reversed_by IS NOT NEW.originally_decided_by;
  -- AND THE DECISION IT NAMES MUST BE THE ONE STANDING. A reversal written
  -- against a decision that is not there is a record of nothing.
  SELECT RAISE(ABORT,'owner_decision_reversal:no_such_decision')
    WHERE NOT EXISTS (SELECT 1 FROM venture_experiments e
                       WHERE e.id = NEW.subject_id
                         AND e.decision = NEW.original_decision
                         AND e.decided_at = NEW.originally_decided_at
                         AND e.decided_by = NEW.originally_decided_by);
END;

CREATE TRIGGER owner_decision_reversal_immutable
BEFORE UPDATE ON owner_decision_reversals
BEGIN
  SELECT RAISE(ABORT,'owner_decision_reversal:immutable');
END;

CREATE TRIGGER owner_decision_reversal_no_delete
BEFORE DELETE ON owner_decision_reversals
BEGIN
  SELECT RAISE(ABORT,'owner_decision_reversal:immutable');
END;

DROP TRIGGER venture_experiment_sealed;
CREATE TRIGGER venture_experiment_sealed
BEFORE UPDATE ON venture_experiments
BEGIN
  -- ONCE HE HAS DECIDED, THE PREDICTION IS SEALED. He approved a specific test
  -- with a specific expectation; a prediction that could be edited afterwards
  -- would make his approval meaningless and the result unfalsifiable in one
  -- stroke.
  SELECT RAISE(ABORT,'venture_experiment:prediction_is_sealed')
    WHERE OLD.decision IS NOT NULL
      AND (NEW.what_we_do IS NOT OLD.what_we_do
        OR NEW.what_we_expect IS NOT OLD.what_we_expect
        OR NEW.would_disprove IS NOT OLD.would_disprove
        OR NEW.cost_cents IS NOT OLD.cost_cents);
  SELECT RAISE(ABORT,'venture_experiment:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id
      OR NEW.opportunity_id IS NOT OLD.opportunity_id
      OR NEW.unknown_id IS NOT OLD.unknown_id
      OR NEW.evidence_mode IS NOT OLD.evidence_mode;
  -- A DECISION STANDS, EXCEPT WHERE HE HAS WITHDRAWN IT ON THE RECORD. The
  -- reversal is written first and cannot be written by anybody but the person
  -- whose decision it was, so this clause never opens a door of its own.
  SELECT RAISE(ABORT,'venture_experiment:already_decided')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NOT OLD.decision
      AND NOT (NEW.decision IS NULL
               AND OLD.ran_at IS NULL
               AND EXISTS (SELECT 1 FROM owner_decision_reversals r
                            WHERE r.subject_kind = 'venture_experiment'
                              AND r.subject_id = OLD.id
                              AND r.original_decision = OLD.decision
                              AND r.reversed_by = OLD.decided_by));
  -- AND ONLY WHILE NOTHING HAS HAPPENED UNDER IT. Once an act was authorised,
  -- somebody written to, or money taken, the decision is part of what the world
  -- already did and unmaking it would make the record lie.
  SELECT RAISE(ABORT,'venture_experiment:reversal_after_consequence')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NULL
      AND (EXISTS (SELECT 1 FROM proposed_acts a
                    WHERE a.experiment_id = OLD.id AND a.decision = 'approved'
                      AND a.revoked_at IS NULL)
        OR EXISTS (SELECT 1 FROM experiment_recipients r
                    WHERE r.experiment_id = OLD.id AND r.authorised_act_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM outbound_actions o WHERE o.experiment_id = OLD.id)
        OR EXISTS (SELECT 1 FROM experiment_fulfilments f WHERE f.experiment_id = OLD.id));
  -- A WITHDRAWN DECISION LEAVES NOTHING BEHIND SAYING IT WAS DECIDED — no
  -- stamp, and no clock still counting down to an answer it no longer owes.
  SELECT RAISE(ABORT,'venture_experiment:reversal_must_clear_the_stamp')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NULL
      AND (NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL
        OR NEW.due_at IS NOT NULL);
  SELECT RAISE(ABORT,'venture_experiment:decision_needs_a_witness')
    WHERE NEW.decision IS NOT NULL AND trim(coalesce(NEW.decided_by,'')) = '';
  -- NOTHING RUNS THAT HE DID NOT APPROVE.
  SELECT RAISE(ABORT,'venture_experiment:not_approved')
    WHERE NEW.ran_at IS NOT NULL AND coalesce(NEW.decision,'') <> 'approved';
  SELECT RAISE(ABORT,'venture_experiment:already_run')
    WHERE OLD.ran_at IS NOT NULL AND NEW.ran_at IS NOT OLD.ran_at;
  -- A RESULT SAYS WHAT HAPPENED AND WHETHER IT WAS WHAT WE SAID WOULD HAPPEN.
  SELECT RAISE(ABORT,'venture_experiment:result_is_incomplete')
    WHERE NEW.ran_at IS NOT NULL
      AND (trim(coalesce(NEW.what_happened,'')) = '' OR NEW.verdict IS NULL);
  -- A RETIRED TEST IS FINISHED WITH. It does not acquire a result later.
  SELECT RAISE(ABORT,'venture_experiment:retired_test_does_not_run')
    WHERE OLD.retired_at IS NOT NULL AND NEW.ran_at IS NOT OLD.ran_at;
END;

-- ── 3 ── One question, one test ──────────────────────────────────────────────

ALTER TABLE venture_experiments ADD COLUMN retired_at TEXT;
ALTER TABLE venture_experiments ADD COLUMN retired_because TEXT;
ALTER TABLE venture_experiments ADD COLUMN superseded_by TEXT
  REFERENCES venture_experiments(id);

CREATE TRIGGER venture_experiment_retirement_guard
BEFORE UPDATE OF retired_at, retired_because, superseded_by ON venture_experiments
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:retirement_needs_a_reason')
    WHERE NEW.retired_at IS NOT NULL AND trim(coalesce(NEW.retired_because,'')) = '';
  SELECT RAISE(ABORT,'venture_experiment:retirement_is_final')
    WHERE OLD.retired_at IS NOT NULL
      AND (NEW.retired_at IS NOT OLD.retired_at
        OR NEW.retired_because IS NOT OLD.retired_because
        OR NEW.superseded_by IS NOT OLD.superseded_by);
  SELECT RAISE(ABORT,'venture_experiment:cannot_supersede_itself')
    WHERE NEW.superseded_by IS NOT NULL AND NEW.superseded_by = OLD.id;
  SELECT RAISE(ABORT,'venture_experiment:superseded_by_unknown')
    WHERE NEW.superseded_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM venture_experiments s WHERE s.id = NEW.superseded_by);
  -- WHAT RAN IS HISTORY, NOT A DUPLICATE. A test with a result is read, never
  -- tidied away for resembling another.
  SELECT RAISE(ABORT,'venture_experiment:cannot_retire_a_test_that_ran')
    WHERE NEW.retired_at IS NOT NULL AND OLD.ran_at IS NOT NULL;
END;
