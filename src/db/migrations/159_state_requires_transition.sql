-- =============================================================================
-- Migration 159: the state machine had a door beside it
--
-- Every rule about how a responsibility may move is enforced BEFORE INSERT ON
-- `responsibility_transitions`: promotions advance exactly one rung, evidence
-- is required, authority is required from 'assisting' upward, the from_state
-- must match what the row actually holds, and — migration 115, the frozen
-- boundary — nothing may enter 'operating' at all.
--
-- None of it is enforced on the responsibility row itself. A plain
--
--   UPDATE institutional_responsibilities SET state = 'operating' WHERE id = ?
--
-- skips all six checks and leaves no transition behind. No TypeScript does that
-- today; the campaign's standard is that a rule must be enforced where the
-- consequence is, not by everyone remembering. THE CONSTITUTIONAL INVARIANT IS
-- "Foundry may not silently redefine what Foundry is allowed to do", and a
-- state column that can be written directly is exactly the silent redefinition
-- it names.
--
-- The rule: a state change must be justified by a transition that recorded it.
-- `responsibility_transition_apply` runs AFTER the transition INSERT, so by the
-- time it updates the row the justifying transition exists and this passes. A
-- direct UPDATE finds none and aborts.
--
-- WHAT THIS DOES NOT CLAIM. A state that already has a transition row can be
-- re-applied — the check is that the move was authorised, not that it is being
-- made for the first time. That is deliberate and it is enough for the property
-- that matters: the freeze means an 'operating' transition can never be
-- inserted, so no such row can ever exist, so `state = 'operating'` is now
-- unreachable by any path rather than by one.
--
-- Both sides of the comparison are NOT NULL in the schema, so there is no
-- three-valued hole here: the predicate is TRUE or FALSE, never NULL.
--
-- AND THE OTHER WAY IN: being BORN in a state. Production never names `state`
-- on insert — `createResponsibility`, the candidate promotion and the discovery
-- path all take the default 'unknown' and then transition — so nothing legitimate
-- needs it. The second trigger refuses birth into the frozen boundary and above.
--
-- Deliberately not the whole ladder: dozens of test fixtures create a
-- responsibility already at 'shadowing' or 'assisting' to set up the case they
-- are actually about, and refusing those would make this a change about test
-- ergonomics rather than about the constitution. What it claims is exactly
-- this: no responsibility can BE 'operating', by birth or by move, on any path.
-- ==============================================================================

CREATE TRIGGER IF NOT EXISTS responsibility_state_requires_transition
BEFORE UPDATE OF state ON institutional_responsibilities
WHEN NEW.state <> OLD.state
BEGIN
  SELECT RAISE(ABORT, 'responsibility_state:no_transition') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_transitions
     WHERE responsibility_id = NEW.id
       AND from_state = OLD.state
       AND to_state = NEW.state
  );
END;

CREATE TRIGGER IF NOT EXISTS responsibility_birth_state_freeze
BEFORE INSERT ON institutional_responsibilities
WHEN NEW.state IN ('operating', 'mature', 'exception_owned')
BEGIN
  SELECT RAISE(ABORT, 'responsibility_state:not_a_birth_state');
END;
