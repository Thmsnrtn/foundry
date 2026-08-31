-- =============================================================================
-- Migration 162: append-only meant a founder could not be erased
--
-- Two rules in direct contradiction, and the erasure one lost every time.
--
-- Migration 118 made `institutional_judgment_dispositions` append-only: "a later
-- change of direction is a new row, never an edit or deletion of the earlier
-- one." Correct — the record of what a founder decided about an institutional
-- judgment must not be rewritten.
--
-- The erasure plan classifies that same table `erase_by_product`, because it is
-- the founder's own decisions about their own company and no allow-list retains
-- it. So `eraseFounderAccount` reached it, the trigger aborted, the failure was
-- recorded rather than swallowed — and the whole erasure stopped:
--
--   {"productsErased":[],"failed":[{"error":"data deletion incomplete:
--     institutional_judgment_dispositions: judgment_disposition:append_only"}],
--    "founderRedacted":false}
--
-- A founder who has ever accepted or rejected one institutional judgment could
-- not be erased AT ALL. Not partially: the founder row is deliberately left
-- intact when any company fails, so nothing was erased and the person stayed.
-- For as long as both rules have existed.
--
-- APPEND-ONLY MEANS HISTORY IS NOT REWRITTEN. It does not mean a person's data
-- outlives their right to have it removed. The delete guard now permits exactly
-- one case: the company is marked for erasure. Editing stays absolutely
-- refused — that is the property the append-only rule is actually for, and it is
-- untouched.
--
-- `products.erasure_scheduled_at` is the marker, set by `scheduleDataDeletion`
-- and now by the immediate path too, so both doors leave the same trace. It is
-- also what already stops the company acting during a wind-down (migration 155),
-- which makes it the honest thing to key on: this is a company on its way out.
--
-- The product row is still present at this point — the erasure plan deletes
-- children before parents — so the marker is readable. The `IS NULL` branch
-- covers the case where it is not, which is fail-open only for a row whose
-- company no longer exists at all.
-- =============================================================================

DROP TRIGGER IF EXISTS institutional_judgment_disposition_append_only_delete;

CREATE TRIGGER institutional_judgment_disposition_append_only_delete
BEFORE DELETE ON institutional_judgment_dispositions
BEGIN
  SELECT RAISE(ABORT, 'judgment_disposition:append_only') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL
  );
END;
