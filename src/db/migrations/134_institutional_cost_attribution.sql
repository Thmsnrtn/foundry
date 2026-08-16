-- Migration 134: attribute cost to institutional truth, not to agent personas.
--
-- THE DEFECT. `cost_events` (migration 023) attributes spend to `agent_name` —
-- a persona from the pre-institutional architecture. That unit cannot answer
-- the question the institution actually needs answered:
--
--   what did it cost to carry THIS responsibility?
--
-- A persona is not a unit of company work. Two personas can serve one
-- responsibility, one persona can serve several, and a responsibility carried
-- with no persona at all — which is every institutional path, since the kernel
-- is model-free — records nothing attributable. The economic invariant is about
-- value per unit of money, computation, time, attention and risk, and none of
-- those divide by persona.
--
-- WHY EXTEND RATHER THAN ADD A LEDGER. A second economics store would mean two
-- answers to one question and a reconciliation problem forever. `cost_events`
-- already has the right shape, one writer, and tenant scoping; it is missing
-- two columns. Adding them is the whole change.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It records no dollar value that nobody
-- measured. A cost that is not observed stays absent, and the reader reports it
-- as unmeasured rather than as zero — those are different facts, and conflating
-- them would manufacture an economics that looks complete and is not.
ALTER TABLE cost_events ADD COLUMN responsibility_id TEXT REFERENCES institutional_responsibilities(id);
ALTER TABLE cost_events ADD COLUMN capability TEXT;

CREATE INDEX IF NOT EXISTS idx_cost_events_responsibility
  ON cost_events(product_id, responsibility_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_events_capability
  ON cost_events(product_id, capability, created_at);

-- Attribution must not cross a tenant boundary. A cost booked against another
-- company's responsibility would corrupt both companies' economics at once, and
-- it is the kind of error that reads as a rounding difference rather than as a
-- leak.
CREATE TRIGGER cost_event_attribution_guard
BEFORE INSERT ON cost_events
BEGIN
  -- Every predicate coalesces its NULL. A guard whose condition evaluates to
  -- NULL never fires, which is how absent values have repeatedly slipped past
  -- guards in this schema.
  SELECT RAISE(ABORT,'cost_event:responsibility_foreign')
  WHERE NEW.responsibility_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r
    WHERE r.id = NEW.responsibility_id AND r.product_id = NEW.product_id);

  -- A capability claim must match the responsibility it is booked against, so
  -- the two attribution axes can never disagree about the same row.
  SELECT RAISE(ABORT,'cost_event:capability_mismatch')
  WHERE NEW.responsibility_id IS NOT NULL AND NEW.capability IS NOT NULL AND EXISTS (
    SELECT 1 FROM institutional_responsibilities r
    WHERE r.id = NEW.responsibility_id
      AND COALESCE(r.capability,'') <> COALESCE(NEW.capability,''));

  -- Negative and missing amounts. An absent amount is not zero spend; it is an
  -- unrecorded event, and it must not be able to enter the ledger as a credit.
  SELECT RAISE(ABORT,'cost_event:amount_invalid')
  WHERE COALESCE(NEW.amount_usd, -1) < 0;
END;

-- Attribution is immutable once written. Cost is evidence about what already
-- happened; re-attributing it later would let an expensive responsibility be
-- made cheap retroactively, which is precisely the number someone would want to
-- change.
CREATE TRIGGER cost_event_attribution_immutable
BEFORE UPDATE ON cost_events
WHEN COALESCE(OLD.responsibility_id,'') <> COALESCE(NEW.responsibility_id,'')
  OR COALESCE(OLD.capability,'') <> COALESCE(NEW.capability,'')
  OR COALESCE(OLD.amount_usd,-1) <> COALESCE(NEW.amount_usd,-1)
BEGIN
  SELECT RAISE(ABORT,'cost_event:attribution_immutable');
END;
