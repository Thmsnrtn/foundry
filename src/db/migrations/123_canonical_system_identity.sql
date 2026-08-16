-- Migration 123: canonical system identity for Foundry's own institutional
-- company/product.
--
-- The defect this closes: three runtime paths resolved "the Foundry company"
-- with `WHERE name = 'Foundry' ORDER BY created_at ASC LIMIT 1`. Foundry-as-a-
-- company was therefore identified by an unowned display string and by row
-- creation order — both mutable, both partly customer-influenced. Renaming the
-- row destroyed the identity; a display field carried semantics it cannot bear.
--
-- Owner decision (recorded): Foundry is a first-class internally owned
-- institutional company/product in the ordinary company/product model. It is
-- NOT a privileged platform scope and NOT a configuration value. The display
-- name is presentation only.
--
-- Schema audit before adding anything: the existing identity-ish primitives are
-- `products.id` (stable but unlabelled), `products.name` (mutable presentation),
-- `products.ingest_token` / `share_token` (unique but rotatable secrets, and
-- caller-presented), and `founders.id` (a person, not an institution). None can
-- express "this specific product IS the institution that runs the platform"
-- without overloading a field that already means something else. The smallest
-- addition that expresses exactly that, and nothing more, is a closed-vocabulary
-- key bound immutably to one product row.
--
-- Constitutional boundary: identity is NOT authority. This table has no
-- capability, scope, consent, path, expiry, budget, or permission column — there
-- is nothing here for any authority lookup to read. Holding the canonical
-- identity buys the Foundry product exactly one thing: it can be found without
-- guessing at a display name. Every capability, effect, receipt, and outcome it
-- touches still crosses the ordinary governed boundaries, and migration 115's
-- Assisting → Operating freeze applies to it exactly as to any customer.
CREATE TABLE system_identities (
  identity_key       TEXT PRIMARY KEY,
  product_id         TEXT NOT NULL UNIQUE REFERENCES products(id),
  established_reason TEXT NOT NULL,
  established_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER system_identity_guard
BEFORE INSERT ON system_identities
BEGIN
  -- Closed vocabulary. A new system identity cannot be invented at runtime;
  -- it requires editing this migration, and migrations are inside the
  -- constitutional ring that ordinary development authority cannot reach.
  SELECT RAISE(ABORT,'system_identity:unknown_identity')
  WHERE NEW.identity_key NOT IN ('foundry');

  -- The slot is claimed once. A second claimant is refused with a domain
  -- reason rather than a primary-key error, so the invariant reads as intent.
  SELECT RAISE(ABORT,'system_identity:already_claimed') WHERE EXISTS (
    SELECT 1 FROM system_identities s WHERE s.identity_key=NEW.identity_key);

  -- The bound row must be a real product. Identity attaches to an ordinary
  -- company/product row; there is no separate privileged entity kind.
  SELECT RAISE(ABORT,'system_identity:product_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id=NEW.product_id);

  SELECT RAISE(ABORT,'system_identity:reason_required')
  WHERE trim(NEW.established_reason)='';
END;

-- Immutable binding. Identity survives renaming, archiving, and ownership
-- change of the underlying row, and cannot be transferred to another entity.
-- Reassignment would mean the platform's own identity could be moved by
-- whoever can run one UPDATE — exactly the weakness this migration removes.
CREATE TRIGGER system_identity_immutable_update
BEFORE UPDATE ON system_identities
BEGIN
  SELECT RAISE(ABORT,'system_identity:immutable');
END;

CREATE TRIGGER system_identity_immutable_delete
BEFORE DELETE ON system_identities
BEGIN
  SELECT RAISE(ABORT,'system_identity:immutable');
END;

-- One-time historical backfill, explicitly bounded to current database reality
-- at the moment this migration runs. This is the ONLY place display name and
-- creation order may be consulted: the historical row was created that way and
-- there is no other record of which row it is. Runtime resolution after this
-- point reads `system_identities` and never `products.name`.
--
-- On a database with no such row this inserts nothing, and the identity stays
-- unclaimed. Unknown is a legitimate state: callers that need the Foundry
-- product treat absence as "not established" and decline to act, rather than
-- falling back to a name guess.
INSERT INTO system_identities (identity_key, product_id, established_reason)
SELECT 'foundry', id,
       'migration 123 one-time backfill of the historically name-resolved Foundry product'
FROM products
WHERE name = 'Foundry' AND deleted_at IS NULL
ORDER BY created_at ASC
LIMIT 1;
