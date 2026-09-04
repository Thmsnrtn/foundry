-- A PREDICTION THAT IS NEVER GRADED TEACHES NOTHING.
--
-- This institution seals predictions with unusual discipline. A venture
-- experiment states what it expects and what would disprove it, and both are
-- sealed at approval. An interpretation states `misread_if` before any
-- confirming evidence arrives, and the database refuses to let it be edited
-- afterwards. Neither is ever compared to what happened.
--
-- `recordResult` — which writes the verdict AND files a surprise as evidence
-- CONTRADICTING the claim, through the ordinary door — has no caller outside
-- tests. `misread_if` has no reader outside display. There is not one aggregate
-- across judgments anywhere in the venture or institution services.
--
-- The consequence is not merely that Foundry cannot report a hit rate. It is
-- that every decision it puts to the owner is the first decision it has ever
-- made, and rubber-stamping is the mathematically correct response to a
-- recommender with no track record.
--
-- It also blocks two things the institution is meant to become. Authority is
-- supposed to be EARNED by demonstrated judgment, and there is no record to earn
-- it against. And effort is supposed to follow surprise — an asset behaving as
-- predicted should cost nothing to watch — which cannot be computed until
-- predictions resolve.

-- WHAT KINDS OF THING THIS INSTITUTION PREDICTS, and what may settle each.
-- Constitutional: a new kind of prediction is a change to what the institution
-- claims to know, not a runtime setting.
CREATE TABLE prediction_kinds (
  kind            TEXT PRIMARY KEY,
  what_it_claims  TEXT NOT NULL,
  sealed_in       TEXT NOT NULL,
  -- What is allowed to settle it. Naming this stops a prediction being marked
  -- correct by the same reasoning that produced it.
  settled_by      TEXT NOT NULL,
  sort_order      INTEGER NOT NULL
);

INSERT INTO prediction_kinds (kind, what_it_claims, sealed_in, settled_by, sort_order) VALUES
  ('venture_experiment',
   'what an experiment will show, and what result would mean we were wrong',
   'venture_experiments.what_we_expect / would_disprove',
   'the experiment being run and its result reported by whoever ran it', 1),
  ('observation_interpretation',
   'what a sentence somebody wrote actually meant, and what would show we misread it',
   'observation_interpretations.reading / misread_if',
   'later evidence about the same seed, or the owner saying it was misread', 2),
  ('institutional_judgment',
   'what Foundry expected to be true of a company it looks after',
   'institutional_judgments',
   'a later observation of that company, timestamped after the judgment', 3),
  ('proposed_act',
   'what an act was expected to achieve when the owner approved it',
   'proposed_acts.expected_effect',
   'the observed effect of the act, and the business outcome after it', 4);

CREATE TRIGGER prediction_kinds_constitutional_insert
BEFORE INSERT ON prediction_kinds
BEGIN SELECT RAISE(ABORT,'prediction_kind:constitutional'); END;
CREATE TRIGGER prediction_kinds_constitutional_update
BEFORE UPDATE ON prediction_kinds
BEGIN SELECT RAISE(ABORT,'prediction_kind:constitutional'); END;
CREATE TRIGGER prediction_kinds_constitutional_delete
BEFORE DELETE ON prediction_kinds
BEGIN SELECT RAISE(ABORT,'prediction_kind:constitutional'); END;

-- THE COMPARISON ITSELF.
--
-- One row per prediction, ever. A prediction that can be graded twice is one
-- that can be graded until it passes.
CREATE TABLE prediction_resolutions (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  kind           TEXT NOT NULL REFERENCES prediction_kinds(kind),
  prediction_id  TEXT NOT NULL,
  -- Who or what settled it. Never 'the model decided it had been right'.
  resolved_by    TEXT NOT NULL CHECK (resolved_by IN
                   ('owner','experiment_result','later_observation','business_outcome')),
  -- The thing that settled it, so the grade can be disagreed with.
  evidence_ref   TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('as_predicted','partly','surprised')),
  because        TEXT NOT NULL,
  -- When the prediction was made, copied here so ordering can be checked
  -- without a join into four different tables.
  predicted_at   TEXT NOT NULL,
  resolved_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_prediction_resolved_once
  ON prediction_resolutions(kind, prediction_id);
CREATE INDEX idx_prediction_resolutions_founder
  ON prediction_resolutions(founder_id, kind, resolved_at);

-- EVIDENCE THAT PREDATES THE PREDICTION IS NOT EVIDENCE.
--
-- The same discipline the judgment observation pass already applies: something
-- already true when the prediction was made cannot be what confirmed it.
-- Same-second evidence is refused as ambiguous rather than given the benefit of
-- the doubt.
CREATE TRIGGER prediction_resolution_must_come_after
BEFORE INSERT ON prediction_resolutions
BEGIN
  SELECT RAISE(ABORT,'prediction_resolution:not_after_the_prediction')
    WHERE datetime(NEW.resolved_at) <= datetime(NEW.predicted_at);
  SELECT RAISE(ABORT,'prediction_resolution:needs_a_reason')
    WHERE trim(NEW.because) = '' OR trim(NEW.evidence_ref) = '';
END;

-- A GRADE THAT CAN BE REWRITTEN IS NOT A GRADE.
CREATE TRIGGER prediction_resolution_is_final
BEFORE UPDATE ON prediction_resolutions
BEGIN SELECT RAISE(ABORT,'prediction_resolution:final'); END;

-- WHEN AN EXPERIMENT IS DUE TO HAVE AN ANSWER.
--
-- Without this, an approved experiment that is never run is invisible rather
-- than overdue — and an unaccounted commitment is exactly what should stop a
-- second one being taken on.
ALTER TABLE venture_experiments ADD COLUMN due_at TEXT;
