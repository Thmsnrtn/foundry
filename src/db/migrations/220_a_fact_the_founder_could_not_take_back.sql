-- =============================================================================
-- A FACT THE FOUNDER COULD NOT TAKE BACK
--
-- `founder_assertion` is evidence that ANSWERS A QUESTION. Migration 125's
-- guard says so and means it: the payload must name an open request of this
-- company for this predicate, which is what makes a replayed answer inert.
--
-- That left a company fact write-once. `submitFounderFact` refuses to restate
-- one that is already grounded, no surface showed the founder what Foundry
-- believed, and no claim in this system is ever given a `valid_until` — so what
-- somebody said once was current forever, and Foundry went on asking for
-- authority on the strength of it. Companies change; a founder mis-states
-- things; neither had a door.
--
-- A CORRECTION IS NOT AN ANSWER, AND THE RECORD SAYS WHICH. Foundry did not ask
-- for this. Recording it against a request row would make the record of what
-- Foundry asked include questions it never put, and reopening an answered
-- request would put the question back in front of the founder — undoing the
-- rule that Foundry does not ask again.
--
-- So it is its own source with its own guard, held to the same standards the
-- answer path is held to: real ownership rather than a caller-supplied founder
-- string, a responsibility of this company, and a predicate that company's
-- capability actually requires. What a caller cannot do is volunteer into a
-- predicate nothing consumes, which is the property the "must be open" rule
-- bought — kept here without foreclosing revision.
--
-- The CLAIM this produces is deliberately identical in shape to an answered
-- one, so no consumer has to learn a second way of knowing a fact. Only the
-- provenance differs, which is the part that should differ.
-- =============================================================================

CREATE TRIGGER founder_correction_guard
BEFORE INSERT ON signal_events WHEN NEW.source='founder_correction'
BEGIN
  SELECT RAISE(ABORT,'founder_correction:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.predicate'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.statement'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.founder_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.responsibility_id'),''))='';

  -- The responsibility is this company's, and the person correcting owns it.
  -- Identity is verified against real ownership: a caller-supplied founder
  -- string cannot establish who is speaking for the company.
  SELECT RAISE(ABORT,'founder_correction:founder_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r
      JOIN products p ON p.id=r.product_id
     WHERE r.id=json_extract(NEW.payload_json,'$.responsibility_id')
       AND r.product_id=NEW.product_id
       AND p.owner_id=json_extract(NEW.payload_json,'$.founder_id'));

  -- A correction may only be about something the institution is already
  -- holding a belief for. Correcting a fact that was never stated is stating
  -- it, and stating one goes through the question path.
  SELECT RAISE(ABORT,'founder_correction:nothing_to_correct') WHERE NOT EXISTS (
    SELECT 1 FROM reconstruction_claims c
     WHERE c.product_id=NEW.product_id
       AND c.subject='responsibility:' || json_extract(NEW.payload_json,'$.responsibility_id')
       AND c.predicate=json_extract(NEW.payload_json,'$.predicate'));
END;
