-- =============================================================================
-- THINKING HAS A PURPOSE
--
-- Every model call is priced to the cent and attributed to a company, a
-- founder, a model and a day — and to nothing it was FOR. Money leaving the
-- institution names its act (asset_money_spent.act_ref); work in a workshop
-- names its subject (workspaces.subject_kind/subject_id); a test names its
-- question (venture_experiments.unknown_id). Cognition was the one resource
-- with a price and no purpose, so "was that question better answered by a
-- seven-dollar test or twenty-five dollars of reasoning" could never be read
-- from rows.
--
-- The purpose is the same (kind, id) shape prediction_resolutions already
-- uses, so cost, verdict and time can be joined on one key. It is optional:
-- a call with no purpose is still attributed to its company or declared
-- institutional; it simply cannot later be compared.
-- =============================================================================
ALTER TABLE ai_spend_reservations ADD COLUMN purpose_kind TEXT
  CHECK (purpose_kind IS NULL OR purpose_kind IN (
    'observation','candidate','experiment','unknown','undertaking','responsibility','workspace','mandate'));
ALTER TABLE ai_spend_reservations ADD COLUMN purpose_id TEXT;
CREATE INDEX idx_ai_spend_purpose ON ai_spend_reservations(purpose_kind, purpose_id)
  WHERE purpose_id IS NOT NULL;

-- Both or neither: a kind without an id names nothing, and an id without a
-- kind cannot be joined.
CREATE TRIGGER ai_spend_purpose_is_whole_insert
BEFORE INSERT ON ai_spend_reservations
WHEN (NEW.purpose_kind IS NULL) <> (NEW.purpose_id IS NULL)
BEGIN SELECT RAISE(ABORT,'ai_spend_reservations:purpose_needs_kind_and_id'); END;
CREATE TRIGGER ai_spend_purpose_is_whole_update
BEFORE UPDATE OF purpose_kind, purpose_id ON ai_spend_reservations
WHEN (NEW.purpose_kind IS NULL) <> (NEW.purpose_id IS NULL)
BEGIN SELECT RAISE(ABORT,'ai_spend_reservations:purpose_needs_kind_and_id'); END;
