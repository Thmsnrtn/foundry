-- =============================================================================
-- WHAT CHANGED SINCE YOU LAST LOOKED
--
-- The first screen answers four of the five questions the owner asks of it: is
-- everything okay, does anything need me, what is Foundry doing, and how do I
-- say something. It has never been able to answer the fifth, because nothing
-- anywhere recorded that he had been here.
--
-- One row per owner, not a log. A visit is not a fact worth keeping forever —
-- what it is for is working out what to tell him this time, and a growing table
-- of every time he opened his own product would be machinery he never asked
-- for and would eventually have to be pruned.
--
-- TWO TIMESTAMPS, AND THE REASON IS THE REFRESH. If the marker advanced on
-- every render, opening the screen and reloading it would erase the summary he
-- had just started reading. `looked_at` moves only when the last visit was long
-- enough ago to count as a separate visit; `since` is the point everything is
-- measured from, and it holds still while he is here.
-- =============================================================================

CREATE TABLE owner_visits (
  founder_id TEXT PRIMARY KEY REFERENCES founders(id) ON DELETE CASCADE,
  -- When he was last here, by the rule above.
  looked_at  TEXT NOT NULL,
  -- The point "what changed" is measured from. Never ahead of looked_at.
  since      TEXT NOT NULL
);

CREATE TRIGGER owner_visit_since_is_not_in_the_future
BEFORE INSERT ON owner_visits
WHEN datetime(NEW.since) > datetime(NEW.looked_at)
BEGIN SELECT RAISE(ABORT,'owner_visit:since_after_looked_at'); END;

CREATE TRIGGER owner_visit_since_does_not_move_forward_past_the_visit
BEFORE UPDATE ON owner_visits
WHEN datetime(NEW.since) > datetime(NEW.looked_at)
BEGIN SELECT RAISE(ABORT,'owner_visit:since_after_looked_at'); END;
