-- Migration 130: fail-closed repair of two guards defeated by SQLite's
-- three-valued logic.
--
-- Migrations 127 and 128 each fixed one instance of this. It is a pattern, not
-- an accident, so every effective trigger was audited for it. The rule that
-- makes a guard vulnerable is narrow and worth stating exactly:
--
--   A `SELECT RAISE(ABORT,…) WHERE <predicate>` fires only when the predicate
--   is TRUE. If a missing JSON key or a NULL column makes it NULL, the RAISE
--   does not fire — and the guard accepts precisely the input it was written
--   to refuse. Predicates of the form `x NOT IN (…)`, `x <> y`, and
--   `json_array_length(x)=0` are all NULL when x is NULL.
--
-- Most guards in this system are already safe, and were left alone. Guards
-- written as `WHERE NOT EXISTS (…)` are inherently fail-closed: a NULL inside
-- the subquery matches no row, so NOT EXISTS becomes TRUE and the refusal
-- fires. Guards written as `WHERE EXISTS (SELECT … WHERE bad OR NOT EXISTS(…))`
-- are also safe, because the inner NOT EXISTS is TRUE when a reference is
-- unresolvable. And several top-level predicates are protected by an explicit
-- `IS NULL OR …` first term, or by an earlier statement in the same trigger
-- body that refuses the absence before the vulnerable line is reached.
--
-- Two were genuinely defeated.

-- ─── 1. Institutional judgment provenance ────────────────────────────────────
-- Migration 116 required a judgment to carry at least two responsibilities and
-- at least one piece of evidence. `evidence_refs_json` was added by ALTER and
-- is therefore nullable, so `json_valid(NULL)=0 OR json_array_length(NULL)=0`
-- evaluated to NULL and the refusal never fired.
--
-- The consequence was not cosmetic. A judgment with real responsibility refs
-- and NO evidence at all was accepted, and everything downstream treats
-- `responsibility_refs_json IS NOT NULL` as the mark of an institutional
-- judgment: the owner disposition guard would accept a direction on it, and the
-- founder's Letter would surface it. "Evidence over narrative" was enforceable
-- everywhere except at the point it is created.
DROP TRIGGER IF EXISTS institutional_judgment_non_authorizing_guard;

CREATE TRIGGER institutional_judgment_non_authorizing_guard
BEFORE INSERT ON strategic_decisions_log WHEN NEW.responsibility_refs_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'institutional_judgment:provenance_required') WHERE
    NEW.evidence_refs_json IS NULL
    OR json_valid(NEW.responsibility_refs_json)=0
    OR coalesce(json_array_length(NEW.responsibility_refs_json),0)<2
    OR json_valid(NEW.evidence_refs_json)=0
    OR coalesce(json_array_length(NEW.evidence_refs_json),0)=0;

  SELECT RAISE(ABORT,'institutional_judgment:tenant_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.responsibility_refs_json) refs
    WHERE NOT EXISTS (
      SELECT 1 FROM institutional_responsibilities r
      WHERE r.id=refs.value AND r.product_id=NEW.product_id));
END;

-- ─── 2. Canonical system identity ────────────────────────────────────────────
-- SQLite permits NULL in a TEXT PRIMARY KEY — a documented quirk, and one that
-- defeated two checks at once. `NULL NOT IN ('foundry')` is NULL, so the closed
-- vocabulary did not refuse it, and `s.identity_key=NEW.identity_key` matched
-- nothing, so the already-claimed check did not either.
--
-- The row that results is not merely junk. `product_id` is UNIQUE, so a
-- NULL-keyed row against the canonical product would occupy that slot forever
-- and make the real identity permanently unclaimable — a denial of identity
-- through a guard that was supposed to protect it.
DROP TRIGGER IF EXISTS system_identity_guard;

CREATE TRIGGER system_identity_guard
BEFORE INSERT ON system_identities
BEGIN
  SELECT RAISE(ABORT,'system_identity:unknown_identity')
  WHERE NEW.identity_key IS NULL OR NEW.identity_key NOT IN ('foundry');

  SELECT RAISE(ABORT,'system_identity:already_claimed') WHERE EXISTS (
    SELECT 1 FROM system_identities s WHERE s.identity_key=NEW.identity_key);

  SELECT RAISE(ABORT,'system_identity:product_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id=NEW.product_id);

  SELECT RAISE(ABORT,'system_identity:reason_required')
  WHERE NEW.established_reason IS NULL OR trim(NEW.established_reason)='';
END;
