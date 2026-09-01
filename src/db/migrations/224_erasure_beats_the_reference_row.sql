-- =============================================================================
-- ERASURE BEATS THE REFERENCE ROW
--
-- Migration 222 refused every delete on `reference_companies`, for a reason that
-- still holds: removing the explanation would leave a synthetic company that
-- nothing identifies as one. What it did not account for is that the row hangs
-- off a company an OWNER owns, and `classifyTables` therefore reads it — with no
-- special case, correctly — as erase-by-product.
--
-- So a founder who had ever asked to be shown a reference company could not be
-- erased at all. The plan reaches this table, the trigger aborts, the failure is
-- recorded rather than swallowed, and the founder row is deliberately left
-- intact when any company fails. The suite said so on the first full run.
--
-- THIS IS MIGRATION 162'S RULE, APPLIED AGAIN. "Append-only means history is not
-- rewritten. It does not mean a person's data outlives their right to have it
-- removed." The same sentence holds here with one word changed: immutable means
-- a reference company cannot quietly stop saying what it is. It does not mean
-- the row outlives the company it describes.
--
-- `products.erasure_scheduled_at` is the marker, readable because the plan
-- deletes children before parents, so the product row is still present. The one
-- permitted case is a company on its way out. Every other delete is refused
-- exactly as before, and the immutability of `products.reality` — the property
-- the whole boundary rests on — is untouched.
-- =============================================================================

DROP TRIGGER IF EXISTS reference_companies_immutable;

CREATE TRIGGER reference_companies_immutable
BEFORE DELETE ON reference_companies
BEGIN
  SELECT RAISE(ABORT, 'reference_company:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL
  );
END;
