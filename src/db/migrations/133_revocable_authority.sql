-- Migration 133: authority is revocable and re-grantable without demoting the
-- responsibility.
--
-- Owner decision: a responsibility's maturity and its currently active execution
-- authority are distinct. A responsibility already in Assisting MAY receive a
-- new responsibility-bound grant after a prior one was revoked, without first
-- being demoted to Shadowing.
--
--   responsibility maturity != authority
--   Assisting                != active permission
--   revocation               != loss of competence
--
-- Migration 112 admitted a responsibility-bound consent only while the
-- responsibility was `shadowing`, which made withdrawal irreversible in place:
-- once admitted, a founder who revoked could never restore permission. That is
-- the wrong shape for a pilot, where "you can always turn it off" is only
-- honest if "you can turn it back on" is true too.
--
-- Migration 112 is not rewritten. This is a forward change to current effective
-- semantics; the historical record stays intact.
DROP TRIGGER IF EXISTS responsibility_authority_guard;

CREATE TRIGGER responsibility_authority_guard
BEFORE INSERT ON autonomy_consents WHEN NEW.responsibility_id IS NOT NULL
BEGIN
  -- A grant is still exact: this owner, this company, this responsibility, this
  -- capability. Being in Assisting is not a qualification that outlives the
  -- checks — every one of them is made again on every new grant.
  SELECT RAISE(ABORT,'responsibility_authority:invalid_binding') WHERE NEW.to_mode!='act' OR NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id AND r.capability=NEW.capability
      AND p.owner_id=NEW.founder_id
      AND r.state IN ('shadowing','assisting')
      AND r.disposition='active'
  );

  -- Re-grant only: the evidence that justified assistance must still exist. A
  -- responsibility that reached Assisting is not permanently qualified
  -- irrespective of later reality.
  --
  -- Scoped to `assisting` deliberately. A FIRST grant is made from Shadowing
  -- before any comparison need exist — the assisting-entry guard is what
  -- requires real comparison evidence there, and it still does. Applying this
  -- check to first grants would tighten a proven path that was not asked to
  -- change, and would break development authority, which is granted the same way.
  SELECT RAISE(ABORT,'responsibility_authority:shadow_evidence_missing')
  WHERE (SELECT r.state FROM institutional_responsibilities r WHERE r.id=NEW.responsibility_id)='assisting'
    AND NOT EXISTS (
    SELECT 1 FROM responsibility_shadow_comparisons c
    JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
    WHERE x.responsibility_id=NEW.responsibility_id AND x.product_id=NEW.product_id
      AND c.classification IN ('matched','deviated')
    );

  SELECT RAISE(ABORT,'responsibility_authority:scope_required') WHERE
    NEW.allowed_scope_json IS NULL OR json_valid(NEW.allowed_scope_json)=0
    OR coalesce(json_array_length(NEW.allowed_scope_json),0)=0;
  SELECT RAISE(ABORT,'responsibility_authority:consequence_required') WHERE
    NEW.consequence_boundary IS NULL OR NEW.consequence_boundary NOT IN ('low','medium','high');
  SELECT RAISE(ABORT,'responsibility_authority:expiry_required') WHERE
    NEW.expires_at IS NULL OR datetime(NEW.expires_at)<=datetime('now');

  -- A new grant is a new authority identity. Reviving a revoked one is not a
  -- re-grant; it is erasing that the founder ever said stop.
  SELECT RAISE(ABORT,'responsibility_authority:revoked_at_birth')
  WHERE NEW.revoked_at IS NOT NULL;
END;

-- A revoked consent stays revoked. Without this, "un-revoking" would be one
-- UPDATE away, and every plan bound to the dead grant would silently become
-- executable again.
CREATE TRIGGER responsibility_authority_revocation_is_permanent
BEFORE UPDATE OF revoked_at ON autonomy_consents
BEGIN
  SELECT RAISE(ABORT,'responsibility_authority:revocation_permanent')
  WHERE OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL;
END;

-- One LIVE plan per inbound message, rather than one ever.
--
-- The previous index counted cancelled plans, which meant a plan stranded by a
-- revocation permanently blocked the message from being answered again — the
-- founder could restore permission and still never reply. A superseded plan is
-- cancelled and steps aside; it does not come back, and its effect identity
-- does not migrate to the new grant.
DROP INDEX IF EXISTS idx_assisted_action_message;
CREATE UNIQUE INDEX idx_assisted_action_message
  ON outbound_actions(product_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL AND status<>'cancelled';
