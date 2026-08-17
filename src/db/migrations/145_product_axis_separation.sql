-- =============================================================================
-- Migration 145 — three product axes, three fields
--
-- A product has three independent facts about it, and until now two fields
-- carried all three:
--
--   LIFECYCLE                does this record exist        products.status
--   OPERATING PERMISSION     may Foundry carry work now    products.scp_status
--   COMMERCIAL ENTITLEMENT   is the account paid up        (nowhere)
--
-- Entitlement had no field, so the hourly sweep wrote it into `scp_status` —
-- the same field a founder writes when they pause their own company, and the
-- same field an operator writes. Three subjects, one field, and no way to tell
-- afterwards which of them had spoken. The sweep's own comment claimed "a
-- product paused for any OTHER reason is left alone"; it could not have been,
-- because the field does not record a reason.
--
-- And the founder's pause was written into `status` as well, which is the
-- LIFECYCLE axis. That axis is read by administration paths to mean "this
-- record still exists" — so pausing a company also removed it from the
-- entitlement sweep, from account-notice delivery, and from the population that
-- billing mail is selected against. A founder who paused their company and then
-- cancelled their subscription would be told nothing about it.
--
-- After this migration:
--
--   status                'active' | 'archived'    lifecycle, nothing else
--   scp_status            operating permission, written by founder/operator
--   entitlement_paused_at commercial entitlement, written by the billing sweep
--
-- 'paused' is normalised off the lifecycle axis and onto the operating one. It
-- is safe to do in place because every writer of `status='paused'` in the
-- codebase writes `scp_status='paused'` in the same request — the two have
-- always moved together, which is precisely why the conflation was invisible.
--
-- A trigger refuses the value from here on, so the separation is structural
-- rather than a convention someone has to remember.
-- =============================================================================

ALTER TABLE products ADD COLUMN entitlement_paused_at TEXT;

-- Any product paused on the lifecycle axis is paused on the operating axis.
-- Ordered so the second statement cannot lose the information the first needs.
UPDATE products
   SET scp_status = 'paused'
 WHERE COALESCE(status, '') = 'paused'
   AND COALESCE(scp_status, '') NOT IN ('archived');

UPDATE products
   SET status = 'active'
 WHERE COALESCE(status, '') = 'paused';

-- From here on, 'paused' is not a lifecycle state.
--
-- COALESCE on both sides: in SQLite `NULL = 'paused'` is NULL, which is not
-- TRUE, so a bare comparison would let a NULL through — harmless here, but the
-- codebase's rule is that every guard predicate coalesces absence, and a guard
-- that is right by accident teaches the next reader the wrong lesson.
CREATE TRIGGER IF NOT EXISTS products_status_is_lifecycle_only_insert
BEFORE INSERT ON products
FOR EACH ROW WHEN COALESCE(NEW.status, '') = 'paused'
BEGIN
  SELECT RAISE(ABORT, 'product_axis:status is the lifecycle axis (active/archived); pause belongs on scp_status');
END;

CREATE TRIGGER IF NOT EXISTS products_status_is_lifecycle_only_update
BEFORE UPDATE ON products
FOR EACH ROW WHEN COALESCE(NEW.status, '') = 'paused'
BEGIN
  SELECT RAISE(ABORT, 'product_axis:status is the lifecycle axis (active/archived); pause belongs on scp_status');
END;

CREATE INDEX IF NOT EXISTS idx_products_entitlement_paused
  ON products(entitlement_paused_at);
