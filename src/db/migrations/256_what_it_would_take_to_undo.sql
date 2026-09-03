-- =============================================================================
-- WHAT IT WOULD TAKE TO UNDO
--
-- The owner asked that a request for authority show four things: what kind of
-- consequence it carries, what it touches, what it costs, and whether it can be
-- undone. The card showed the first three badly and the fourth not at all — it
-- carried a low/medium/high consequence that was never rendered, and had no
-- notion of cost or of reversal.
--
-- Two of those the institution already knew and was not saying. The rungs are a
-- far better vocabulary than low/medium/high: `destructive` already says in its
-- own words that it cannot be undone, and `absorbable` already says whether any
-- standing policy may ever pre-authorise the class. What was missing was the
-- sentence a person actually wants before saying yes — if this turns out to be
-- wrong, what does putting it back involve?
--
-- So each rung carries that sentence, and a proposed act carries its rung and
-- what it would cost. Cost is nullable because "I do not know what this costs"
-- is a real answer and is better said than guessed at.
-- =============================================================================

DROP TRIGGER consequence_rungs_constitutional_insert;
DROP TRIGGER consequence_rungs_constitutional_update;
DROP TRIGGER consequence_rungs_constitutional_delete;

ALTER TABLE consequence_rungs ADD COLUMN putting_it_back TEXT NOT NULL DEFAULT '';

UPDATE consequence_rungs SET putting_it_back =
  'nothing to put back - it changed nothing' WHERE rung = 'observe';
UPDATE consequence_rungs SET putting_it_back =
  'throw the draft away; nobody outside ever saw it' WHERE rung = 'prepare';
UPDATE consequence_rungs SET putting_it_back =
  'set it back to what it was, and it is as though it never happened'
 WHERE rung = 'reversible';
UPDATE consequence_rungs SET putting_it_back =
  'the message can be corrected or retracted, but it cannot be unread'
 WHERE rung = 'public';
UPDATE consequence_rungs SET putting_it_back =
  'money can usually be moved back, though fees, timing and someone else''s '
  || 'accounting may not come with it' WHERE rung = 'financial';
UPDATE consequence_rungs SET putting_it_back =
  'a commitment can sometimes be ended, but ending one is itself a legal act '
  || 'and not yours alone to make' WHERE rung = 'legal';
UPDATE consequence_rungs SET putting_it_back =
  'nothing. This is the rung where putting it back is not available'
 WHERE rung = 'destructive';

CREATE TRIGGER consequence_rungs_constitutional_insert BEFORE INSERT ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;
CREATE TRIGGER consequence_rungs_constitutional_update BEFORE UPDATE ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;
CREATE TRIGGER consequence_rungs_constitutional_delete BEFORE DELETE ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;

-- WHAT THIS PARTICULAR ACT WOULD COST, AND WHICH RUNG IT SITS ON.
--
-- Nullable, both of them, and deliberately. An act proposed before this existed
-- has no rung recorded, and inventing one for it afterwards would be asserting
-- a classification nobody made. The card says so rather than guessing.
ALTER TABLE proposed_acts ADD COLUMN rung TEXT REFERENCES consequence_rungs(rung);
ALTER TABLE proposed_acts ADD COLUMN cost_cents INTEGER;

CREATE TRIGGER proposed_act_rung_must_exist BEFORE INSERT ON proposed_acts
WHEN NEW.rung IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'proposed_act:unknown_rung')
    WHERE NOT EXISTS (SELECT 1 FROM consequence_rungs WHERE rung = NEW.rung);
END;

-- A cost is a number of cents or it is unknown. It is never negative, because a
-- proposal that pays him is not a cost and saying so here would hide it.
CREATE TRIGGER proposed_act_cost_is_not_negative BEFORE INSERT ON proposed_acts
WHEN NEW.cost_cents IS NOT NULL AND NEW.cost_cents < 0
BEGIN SELECT RAISE(ABORT,'proposed_act:negative_cost'); END;
