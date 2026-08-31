-- =============================================================================
-- Migration 166: a responsibility can be due
--
-- THE INSTITUTION HAD NO SENSE OF TIME.
--
-- `institutional_responsibilities` records what the company owes, who is
-- carrying it, what evidence discovered it and what authority permits acting —
-- and not when it is due. The vocabulary Foundry offers the founder is
-- entirely date-shaped:
--
--   recurring_work       'Something that has to happen regularly'
--   delivery             'Something we owe someone by a date'
--   customer_commitment  'Something a customer is waiting on'
--
-- A founder could say "renew the insurance by 1 March", and Foundry stored the
-- sentence and could never learn that 1 March arrived. The code says so twice,
-- unprompted: `institutional-judgment.ts` emits `deadline unknown` as an
-- uncertainty on EVERY judgment it makes, because `Demand.deadline` has no
-- supply anywhere; and `institutional-judgment-evaluation.ts` records that it
-- can never report `contradicted` because "contradiction needs an observer
-- that can see a deadline pass, which does not exist yet".
--
-- Time is also the only fact about a company Foundry can establish with no
-- founder, no provider and no integration. Every other independent
-- observation requires an outside system to speak. This one requires a clock,
-- which makes it the first sense the institution can supply itself.
--
-- THE DATE COMES FROM THE COMPANY, NEVER FROM FOUNDRY.
--
-- This is the same line migration 137 draws for outcomes, for the same reason.
-- If Foundry may invent a deadline, it may later judge itself against a
-- deadline it invented — and `contradicted`, the verdict this unlocks, would
-- become a thing the institution can manufacture about itself. So a due date
-- carries who stated it, and the trigger refuses one the institution authored.
-- =============================================================================

ALTER TABLE institutional_responsibilities ADD COLUMN due_at DATETIME;

-- WHO SAID SO. A founder id, or the ingest channel key a company's own system
-- reported through. Never a Foundry-side identity.
ALTER TABLE institutional_responsibilities ADD COLUMN due_stated_by TEXT;

-- A date with no author is not evidence of anything, and an author with no
-- date says nothing. Both or neither.
DROP TRIGGER IF EXISTS responsibility_due_date_needs_a_source;
CREATE TRIGGER responsibility_due_date_needs_a_source
BEFORE UPDATE OF due_at, due_stated_by ON institutional_responsibilities
WHEN (NEW.due_at IS NOT NULL) <> (NEW.due_stated_by IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'responsibility_due:date_and_source_go_together');
END;

DROP TRIGGER IF EXISTS responsibility_due_date_needs_a_source_insert;
CREATE TRIGGER responsibility_due_date_needs_a_source_insert
BEFORE INSERT ON institutional_responsibilities
WHEN (NEW.due_at IS NOT NULL) <> (NEW.due_stated_by IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'responsibility_due:date_and_source_go_together');
END;

-- AND FOUNDRY MAY NOT SET ITS OWN DEADLINES. `system_identities` names which
-- product row is Foundry's own company; the owner of that row is the one
-- principal that must not author a due date on any company, because a
-- deadline it wrote is a deadline it could then report itself as having
-- missed or met.
DROP TRIGGER IF EXISTS responsibility_due_date_not_self_authored;
CREATE TRIGGER responsibility_due_date_not_self_authored
BEFORE INSERT ON institutional_responsibilities
WHEN NEW.due_stated_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'responsibility_due:institution_may_not_state_a_deadline')
  WHERE EXISTS (
    SELECT 1 FROM system_identities s
      JOIN products p ON p.id = s.product_id
     WHERE p.owner_id = NEW.due_stated_by);
END;

DROP TRIGGER IF EXISTS responsibility_due_date_not_self_authored_update;
CREATE TRIGGER responsibility_due_date_not_self_authored_update
BEFORE UPDATE OF due_at, due_stated_by ON institutional_responsibilities
WHEN NEW.due_stated_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'responsibility_due:institution_may_not_state_a_deadline')
  WHERE EXISTS (
    SELECT 1 FROM system_identities s
      JOIN products p ON p.id = s.product_id
     WHERE p.owner_id = NEW.due_stated_by);
END;

CREATE INDEX IF NOT EXISTS idx_responsibilities_due
  ON institutional_responsibilities(product_id, due_at)
  WHERE due_at IS NOT NULL;
