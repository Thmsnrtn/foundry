-- =============================================================================
-- I CANNOT SEE THE MARKET
--
-- The venture acceptance test asks Foundry to "research broadly, identify real
-- recurring customer problems, investigate market structure, analyse competitors
-- and substitutes, evaluate distribution". Every one of those is a claim about
-- the world OUTSIDE the owner's companies, and Foundry has no way to look.
--
-- WHAT MAKES THIS A SENSE RATHER THAN A MISSING FEATURE. Every other gap in this
-- institution is already expressed the same way: a thing it cannot see, who
-- could supply it, and what supplying it would never permit. Market research is
-- exactly that shape. Modelling it as a sense means the venture machinery can be
-- built, steered and stopped now, and will say "I cannot see what is happening
-- outside your companies" instead of producing candidates.
--
-- AND THE ALTERNATIVE IS THE THING THIS INSTITUTION REFUSES. A language model
-- can produce a fluent market analysis from recollection, with no source anyone
-- could check, and it would read exactly like research. That is invented
-- evidence wearing a research report's clothes — and it would be laundered into
-- owner truth the moment a company was created on the strength of it. Migration
-- 233 makes that structurally impossible: an opportunity may not be advanced
-- with an empty source list.
--
-- NO PROVIDER IS DECLARED. Not an oversight: nothing has been chosen, so
-- nothing is offered, and the owner is told the gap exists and that nothing he
-- can connect would close it. A named provider with no adapter would be a
-- button; an undeclared one is an honest absence.
-- =============================================================================

DROP TRIGGER senses_constitutional_insert;
DROP TRIGGER senses_constitutional_update;
DROP TRIGGER senses_constitutional_delete;

INSERT INTO senses (sense_key, cannot_see, would_learn, never_grants, channels_json, sort_order)
VALUES ('market', 'what is happening outside your companies',
  'who has a problem worth solving, who already solves it, how they reach '
  || 'people, and what anyone pays',
  'contact anyone I find, spend anything, commit you to anything, or create a '
  || 'company on my own',
  '[]', 8);

CREATE TRIGGER senses_constitutional_insert BEFORE INSERT ON senses
BEGIN SELECT RAISE(ABORT,'sense:constitutional'); END;
CREATE TRIGGER senses_constitutional_update BEFORE UPDATE ON senses
BEGIN SELECT RAISE(ABORT,'sense:constitutional'); END;
CREATE TRIGGER senses_constitutional_delete BEFORE DELETE ON senses
BEGIN SELECT RAISE(ABORT,'sense:constitutional'); END;
