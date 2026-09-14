-- =============================================================================
-- A QUESTION ABOUT THE WORLD IS NOT A NOTE ABOUT A SOURCE.
--
-- `market_unknowns` holds what nobody has answered yet, and the forge — the
-- surface that asks what is worth testing next — reads it. Reading production
-- while building that surface showed the table holding two different kinds of
-- thing under one column, written by one writer, told apart only by a prefix
-- that writer happened to put there:
--
--   'whether anybody would pay for it, which nothing read so far can answer'
--   'unclear from the source: It is unclear whether this is a one-off ...'
--   'it could instead mean: This could just be a passing technical question ...'
--
-- The first is a question you can put to the world. The other two are readings
-- OF A SOURCE — what the text might have meant, and how it might have been
-- misread. They belong in the record, because a candidate built on a reading
-- should carry the ways that reading could be wrong. They do not belong in a
-- list of things worth testing, and one of them cannot be settled by any
-- experiment at all: no amount of contacting strangers establishes what a
-- forum post from last year meant.
--
-- WHY THIS MATTERS MORE THAN TIDINESS. `matchRealityOnly` marks an unknown
-- BLOCKING when it looks like a reality-only question, and it matches on
-- phrases. Several source notes in production are marked blocking because the
-- ambiguity they describe happens to be about whether somebody would pay. A
-- surface that ranks by blocking would put "it could instead mean: this could
-- just be a passing technical question" at the top of what to test next.
--
-- THE BACKFILL EXACTLY REVERSES THE WRITER. `services/venture/discovery.ts`
-- composes these two strings with those two prefixes and nothing else does, so
-- the prefix is the writer's own marker rather than a guess about English. A
-- row that matches neither stays a question, which is the safe direction: a
-- genuine question misfiled as a note would disappear from the forge, and a
-- note misfiled as a question is merely noise somebody can see.
-- =============================================================================

ALTER TABLE market_unknowns ADD COLUMN kind TEXT NOT NULL DEFAULT 'question'
  CHECK (kind IN ('question','source_ambiguity','alternative_reading'));

UPDATE market_unknowns SET kind = 'source_ambiguity'
 WHERE question LIKE 'unclear from the source:%';

UPDATE market_unknowns SET kind = 'alternative_reading'
 WHERE question LIKE 'it could instead mean:%';

-- A note about a source is not blocking a decision, whatever a phrase match
-- made of it. It cannot be settled by any test, so it cannot be what stops one.
UPDATE market_unknowns SET blocking = 0
 WHERE kind IN ('source_ambiguity','alternative_reading') AND blocking = 1;

CREATE INDEX IF NOT EXISTS idx_market_unknowns_open
  ON market_unknowns(founder_id, kind, answered_at);
