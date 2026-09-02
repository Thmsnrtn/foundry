-- =============================================================================
-- SIX INCOME STREAMS, OR ONE WITH SIX FAILURE POINTS IN COMMON
--
-- The owner's evolution of the venture mandate: a candidate is not attractive
-- because it might make money in isolation. What matters is what adding it does
-- to the portfolio he already owns.
--
-- Six SaaS products all reached through Google search, all billed through
-- Stripe, all built on the same model provider, all sold to the same segment are
-- NOT six independent income streams. An institution that counted them as six
-- would be helping him concentrate while telling him he was diversifying — and
-- it would do so with a straight face, because each one on its own looks fine.
--
-- WHAT AN EXPOSURE IS. One fact about how a company or a candidate makes money:
-- which channel brings its customers, whose rails carry its billing, whose model
-- it depends on, who it sells to. Concentration is then arithmetic — how many
-- things in the portfolio carry the same one — rather than a judgement somebody
-- has to make about the whole.
--
-- NO SCORE, DELIBERATELY. The owner was explicit: not mathematical theatre, not
-- false precision. There is no risk number here and there will not be one. The
-- questions are "if this succeeds, does the portfolio get stronger?" and "what
-- single failure could damage several of these at once?", and both are answered
-- by NAMING the shared exposure and how many carry it. A weighted score would
-- be more impressive and less arguable, which is the wrong trade for a decision
-- that is his.
--
-- THE DIMENSIONS ARE CONSTITUTIONAL; THE VALUES ARE NOT. Adding a dimension is a
-- migration and a conversation, because it changes what the institution is able
-- to notice. The values inside one are free text on purpose: "reached through a
-- podcast nobody has heard of" is a real exposure, and a closed vocabulary of
-- channels would quietly become the search space — the exact failure the owner
-- named about economic forms.
-- =============================================================================

CREATE TABLE exposure_dimensions (
  dimension    TEXT PRIMARY KEY,
  -- Completes "if this went wrong, ...". What the owner would actually lose.
  if_it_fails  TEXT NOT NULL,
  sort_order   INTEGER NOT NULL
);

INSERT INTO exposure_dimensions (dimension, if_it_fails, sort_order) VALUES
  ('revenue_model', 'everything earning this way stops earning the same way at once', 1),
  ('customer_type', 'one kind of buyer changing their mind hits all of them', 2),
  ('industry', 'one industry having a bad year is several of your businesses having one', 3),
  ('pricing_model', 'one shift in what people will pay for moves all of them together', 4),
  ('acquisition_channel', 'one channel closing takes the customers of everything on it', 5),
  ('platform_dependency', 'one platform changing its rules affects all of them', 6),
  ('provider_dependency', 'one provider failing, repricing or dropping you affects all of them', 7),
  ('ai_dependency', 'one model provider changing price or terms moves the costs of all of them', 8),
  ('technical_stack', 'one dependency breaking is several outages rather than one', 9),
  ('geography', 'one jurisdiction changing the rules reaches all of them', 10),
  ('capital_intensity', 'several things needing money at the same moment', 11),
  ('support_burden', 'several things needing a person at the same moment', 12),
  ('operational_burden', 'the running of them stacking up rather than spreading out', 13),
  ('owner_attention', 'several of them wanting you at once, which is the scarcest thing', 14),
  ('time_to_revenue', 'nothing paying for a long time because everything is early together', 15),
  ('retention', 'churn moving the same way across all of them', 16);

CREATE TRIGGER exposure_dimensions_constitutional_insert
BEFORE INSERT ON exposure_dimensions
BEGIN SELECT RAISE(ABORT,'exposure_dimension:constitutional'); END;
CREATE TRIGGER exposure_dimensions_constitutional_update
BEFORE UPDATE ON exposure_dimensions
BEGIN SELECT RAISE(ABORT,'exposure_dimension:constitutional'); END;
CREATE TRIGGER exposure_dimensions_constitutional_delete
BEFORE DELETE ON exposure_dimensions
BEGIN SELECT RAISE(ABORT,'exposure_dimension:constitutional'); END;

-- ONE FACT ABOUT HOW SOMETHING MAKES MONEY.
--
-- `subject_kind` lets a company and a candidate be measured on the same axes,
-- which is the whole point: "what would adding this do" is only answerable if
-- the thing being added is described the same way as the things already there.
CREATE TABLE portfolio_exposures (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('company','opportunity')),
  subject_id    TEXT NOT NULL,
  dimension     TEXT NOT NULL REFERENCES exposure_dimensions(dimension),
  value         TEXT NOT NULL,
  -- HOW THIS IS KNOWN. An exposure the owner stated is a different thing from
  -- one Foundry inferred from a reading, and the difference has to survive into
  -- the sentence he is shown — otherwise a guess becomes a fact by being
  -- rendered next to one.
  how_known     TEXT NOT NULL CHECK (how_known IN ('owner_said','observed','inferred')),
  -- Which world it came from, so a reference company's exposures never count
  -- toward a real concentration.
  evidence_mode TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  noted_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at    TEXT
);

CREATE UNIQUE INDEX idx_portfolio_exposure_one_live
  ON portfolio_exposures(subject_kind, subject_id, dimension, value)
  WHERE retired_at IS NULL;

CREATE TRIGGER portfolio_exposure_guard
BEFORE INSERT ON portfolio_exposures
BEGIN
  SELECT RAISE(ABORT,'portfolio_exposure:incomplete')
    WHERE trim(NEW.subject_id) = '' OR trim(NEW.value) = '';
  SELECT RAISE(ABORT,'portfolio_exposure:cannot_arrive_retired')
    WHERE NEW.retired_at IS NOT NULL;
  -- A COMPANY'S EXPOSURE IS ONLY EVER AS REAL AS THE COMPANY. Without this, a
  -- reference company's dependence on a provider would count toward a real
  -- concentration and the owner would be told to diversify away from something
  -- no real business of his uses.
  SELECT RAISE(ABORT,'portfolio_exposure:evidence_mode_mismatch')
    WHERE NEW.subject_kind = 'company'
      AND (NEW.evidence_mode = 'reference') <> EXISTS (
        SELECT 1 FROM products WHERE id = NEW.subject_id AND reality = 'reference');
END;

CREATE TRIGGER portfolio_exposure_retire_is_one_way
BEFORE UPDATE ON portfolio_exposures
BEGIN
  SELECT RAISE(ABORT,'portfolio_exposure:already_retired')
    WHERE OLD.retired_at IS NOT NULL;
  SELECT RAISE(ABORT,'portfolio_exposure:immutable')
    WHERE NEW.subject_id IS NOT OLD.subject_id OR NEW.dimension IS NOT OLD.dimension
       OR NEW.value IS NOT OLD.value OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.evidence_mode IS NOT OLD.evidence_mode;
END;

CREATE INDEX idx_portfolio_exposures_live
  ON portfolio_exposures(founder_id, dimension) WHERE retired_at IS NULL;
