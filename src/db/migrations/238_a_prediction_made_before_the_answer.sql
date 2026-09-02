-- =============================================================================
-- A PREDICTION MADE BEFORE THE ANSWER ARRIVES
--
-- Migration 236 gave a candidate claims, evidence and unknowns. It stopped one
-- step short of the thing that makes research change anybody's mind: an
-- unknown with a cheapest test is a plan, and a plan nobody ran teaches
-- nothing. So this is how a question gets answered — and, more importantly,
-- what has to be said BEFORE it is.
--
-- THE PREDICTION IS THE POINT. `what_we_expect` and `would_disprove` are both
-- NOT NULL and both sealed the moment the owner approves the experiment. An
-- expectation written after the result is a description; one that nothing could
-- contradict is a mood. Either would let the institution run tests forever and
-- be surprised by nothing, which is the failure mode of a research function
-- that exists to justify what somebody already wanted to do.
--
-- AND A RESULT IS AN OBSERVATION LIKE ANY OTHER. When an experiment comes back
-- it files evidence through the same door as a forum thread or a pricing page,
-- carrying the same source, date and bearing. Its privileged status is not that
-- it counts for more — it is only that its prediction was on the record first.
-- An institution whose own tests entered by a special door would be grading its
-- own homework.
--
-- NOTHING RUNS WITHOUT HIM. An experiment costs money or contacts people or
-- both, and there is no company here to have granted an allowance. So the
-- decision is his, per experiment, before it runs — the same shape as every
-- other consequential act in this system, for the same reason.
-- =============================================================================

CREATE TABLE venture_experiments (
  id             TEXT PRIMARY KEY,
  -- Carried directly rather than reached by a join, so erasure finds it.
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  opportunity_id TEXT NOT NULL REFERENCES venture_opportunities(id),
  -- The question it exists to answer. An experiment attached to no unknown is
  -- activity rather than research.
  unknown_id     TEXT NOT NULL REFERENCES market_unknowns(id),
  -- The claim its result would bear on, when it bears on one.
  claim_id       TEXT REFERENCES market_claims(id),

  -- What would actually be done, concretely enough to do.
  what_we_do     TEXT NOT NULL,
  -- What we expect to see. Written before, sealed at approval.
  what_we_expect TEXT NOT NULL,
  -- WHAT RESULT WOULD MEAN WE WERE WRONG. The half people skip, and the half
  -- that makes the other half mean anything.
  would_disprove TEXT NOT NULL,
  cost_cents     INTEGER NOT NULL DEFAULT 0,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  proposed_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- His decision, before anything happens.
  decision       TEXT CHECK (decision IN ('approved','declined')),
  decided_at     TEXT,
  decided_by     TEXT,

  ran_at         TEXT,
  -- What actually happened, in the words of whoever saw it.
  what_happened  TEXT,
  verdict        TEXT CHECK (verdict IN ('as_predicted','surprised'))
);

CREATE TRIGGER venture_experiment_guard
BEFORE INSERT ON venture_experiments
BEGIN
  SELECT RAISE(ABORT,'venture_experiment:incomplete')
    WHERE trim(NEW.what_we_do) = '' OR trim(NEW.what_we_expect) = ''
       OR trim(NEW.would_disprove) = '';
  SELECT RAISE(ABORT,'venture_experiment:cannot_arrive_decided')
    WHERE NEW.decision IS NOT NULL;
  SELECT RAISE(ABORT,'venture_experiment:cannot_arrive_run')
    WHERE NEW.ran_at IS NOT NULL OR NEW.what_happened IS NOT NULL
       OR NEW.verdict IS NOT NULL;
  SELECT RAISE(ABORT,'venture_experiment:cost_cannot_be_negative')
    WHERE NEW.cost_cents < 0;
  -- AN EXPERIMENT AGAINST AN ANSWERED QUESTION IS BUSYWORK.
  SELECT RAISE(ABORT,'venture_experiment:unknown_already_answered')
    WHERE EXISTS (SELECT 1 FROM market_unknowns
                   WHERE id = NEW.unknown_id AND answered_at IS NOT NULL);
  -- The experiment is only ever as real as what it is about.
  SELECT RAISE(ABORT,'venture_experiment:evidence_mode_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM venture_opportunities o
     WHERE o.id = NEW.opportunity_id AND o.evidence_mode = NEW.evidence_mode);
END;

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
  SELECT RAISE(ABORT,'venture_experiment:already_decided')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NOT OLD.decision;
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
END;

CREATE INDEX idx_venture_experiments_open
  ON venture_experiments(opportunity_id) WHERE ran_at IS NULL;
