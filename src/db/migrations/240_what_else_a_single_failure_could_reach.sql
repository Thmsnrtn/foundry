-- =============================================================================
-- WHAT ELSE A SINGLE FAILURE COULD REACH
--
-- Migration 235 named sixteen axes a portfolio can be concentrated on. The
-- owner's maturing of the mandate named five more, and each is a way six
-- businesses can be one:
--
--   legal_exposure      the same regulation, the same kind of liability, the
--                       same professional-reliance question. A rule change that
--                       hits one hits all of them, and it is the concentration
--                       hardest to see because nothing in the numbers shows it
--                       until the day it does.
--   data_dependency     the same upstream dataset, register or feed. Different
--                       from a provider: the provider can be swapped, the data
--                       often cannot.
--   seasonality         the same time of year. Four things that all earn in Q4
--                       are one thing that earns in Q4.
--   technical_coupling  the same shared runtime, database or library, which is
--                       where the river-of-nickels economy turns into one outage.
--   failure_domain      what actually goes down together - the one honest name
--                       for "these share a fate", when none of the others quite
--                       says why.
--
-- CONSTITUTIONAL, SO THIS IS A MIGRATION AND NOT A SETTING. Adding an axis
-- changes what the institution is able to notice, and that is a conversation
-- with a record, not a row somebody inserts.
-- =============================================================================

DROP TRIGGER exposure_dimensions_constitutional_insert;

INSERT INTO exposure_dimensions (dimension, if_it_fails, sort_order) VALUES
  ('legal_exposure', 'one rule change or one kind of claim reaches all of them at once', 17),
  ('data_dependency', 'one upstream source changing its terms or going dark starves all of them', 18),
  ('seasonality', 'the same quiet months for all of them, with nothing earning in between', 19),
  ('technical_coupling', 'one shared component failing is several outages rather than one', 20),
  ('failure_domain', 'they go down together, whatever the reason', 21);

CREATE TRIGGER exposure_dimensions_constitutional_insert
BEFORE INSERT ON exposure_dimensions
BEGIN SELECT RAISE(ABORT,'exposure_dimension:constitutional'); END;

-- WHAT WOULD MAKE A DEAD IDEA WORTH ANOTHER LOOK.
--
-- The graveyard is an asset only if it can answer two questions: why did this
-- die, and what would have to change. The first was already kept. The second
-- was not, and without it a rejected thesis is indistinguishable from a bad
-- one - which is how an institution ends up either re-discovering the same
-- idea every quarter or never revisiting one the world has since made good.
ALTER TABLE venture_opportunities ADD COLUMN revisit_if TEXT;
