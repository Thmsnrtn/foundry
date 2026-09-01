-- =============================================================================
-- A COMPANY THAT IS NOT REAL
--
-- THE DEADLOCK THIS BREAKS. Private Foundry cannot be completed without company
-- data to exercise it, and no owner should entrust a real company to it until
-- it is complete. The resolution is a REFERENCE company: synthetic, rich enough
-- to exercise the actual institution — revenue, customers, churn, incidents,
-- support, deploys — whose data may never become owner truth, real outcome
-- evidence, real spend, or grounds for real-world authority.
--
-- That guarantee has to be STRUCTURAL. Six independent readers of this codebase
-- were asked what would break if a synthetic company existed, and between them
-- they found roughly thirty paths by which its data reaches the owner: the
-- fleet letter would ask him to act on fiction; `getPulse` sums metric_snapshots
-- across every product with no filter; the outbound gateway would send a real
-- email with a real credential; `assisting-admission` counts outcomes on the
-- card where he grants authority; the cross-company wisdom pools have
-- contributor floors a fabricated company could clear; and the global $500/day
-- model ceiling is shared, so a rehearsal could starve the real companies.
--
-- None of those is a place to remember a rule. So the fact lives here, in one
-- column, with the properties that make forgetting impossible:
--
--   NOT NULL         every company answers the question; there is no row whose
--                    reality is unknown, and no default that means "not asked".
--   CHECK            a closed vocabulary of two. A third kind of reality is a
--                    schema change and a conversation, not a typo.
--   DEFAULT 'real'   the SAFE default. A company created by any of the paths
--                    that predate this migration is real, which is what those
--                    paths meant. Synthetic must be asked for explicitly.
--   immutable        a company cannot be promoted into reality, or demoted out
--                    of it, by an UPDATE. Evidence gathered while synthetic
--                    would otherwise become real evidence by editing one field.
--
-- WHY NOT FOLD IT INTO `operatingProduct()`. Because that predicate answers
-- "may the institution act for this company", and a reference company MAY be
-- acted for — that is the entire point of it. What changes is where the results
-- may go. Folding a fourth axis in would also corrupt `companyMayBeChanged`,
-- whose reason union is closed and whose ladder walks the columns in order.
-- This is a separate axis with a separate predicate, applied deliberately at
-- each boundary rather than universally by accident.
-- =============================================================================

ALTER TABLE products ADD COLUMN reality TEXT NOT NULL DEFAULT 'real'
  CHECK (reality IN ('real', 'reference'));

-- WHY A COMPANY MAY NOT CHANGE WHAT IT IS.
--
-- The whole guarantee is that synthetic evidence never becomes real evidence.
-- If reality were editable, every fact a reference company accumulated —
-- outcomes, comparisons, spend, track record — would become real the moment
-- somebody ran one UPDATE, and nothing downstream would ever know. The
-- institution already refuses to move a bound `system_identities` row for the
-- same reason: an identity that can be reassigned is not an identity.
CREATE TRIGGER products_reality_immutable
BEFORE UPDATE OF reality ON products
WHEN NEW.reality IS NOT OLD.reality
BEGIN
  SELECT RAISE(ABORT, 'products:reality_immutable');
END;

-- WHY A REFERENCE COMPANY IS A ROW SOMEWHERE ELSE TOO.
--
-- The column says WHAT a company is. This says WHY it exists and what it is
-- for, which is what a person needs a year from now when they find a company in
-- the database that nobody remembers creating. Same shape as
-- `system_identities`: written once, never moved, and carrying provenance that
-- validation alone would not preserve.
--
-- `scenario` names the situation the company exists to exercise — 'a
-- subscription business whose revenue is falling', 'a company that exceeded its
-- budget'. It is the reason this row is allowed to exist at all: a reference
-- company that exercises nothing is just fiction in the database.
CREATE TABLE reference_companies (
  product_id    TEXT PRIMARY KEY REFERENCES products(id),
  scenario      TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER reference_companies_guard
BEFORE INSERT ON reference_companies
BEGIN
  SELECT RAISE(ABORT, 'reference_company:reason_required')
    WHERE trim(NEW.scenario) = '' OR trim(NEW.purpose) = '';
  -- The row and the column cannot disagree. A reference_companies row for a
  -- company marked real would be a lie in whichever direction it was read.
  SELECT RAISE(ABORT, 'reference_company:not_a_reference')
    WHERE NOT EXISTS (
      SELECT 1 FROM products WHERE id = NEW.product_id AND reality = 'reference');
END;

-- Deletion is refused for the same reason the column is immutable: removing the
-- explanation would leave a synthetic company that nothing identifies as one.
CREATE TRIGGER reference_companies_immutable
BEFORE DELETE ON reference_companies
BEGIN
  SELECT RAISE(ABORT, 'reference_company:immutable');
END;

CREATE INDEX idx_products_reality ON products(reality);
