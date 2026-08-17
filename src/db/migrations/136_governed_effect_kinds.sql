-- Migration 136: the governed effect boundary stops being support-only.
--
-- THE DEFECT. Migration 114's guard is the boundary that makes irreversible
-- things irreversible, and it was written around exactly one use:
--
--   action_type='send_email' AND integration_name='resend'
--   AND authority_scope='send_email:support_reply'
--   AND r.capability='customer_support'
--
-- Everything ELSE in that guard is genuinely general — Assisting state, the
-- authority reference matching the consent, the consent bound to this
-- responsibility, capability agreement between them, live and unexpired and
-- unrevoked, low consequence, and the scope present in the granted list. Only
-- the four clauses above tie a general mechanism to one SaaS-shaped case.
--
-- The consequence showed up the moment four unfamiliar companies were carried
-- up the ladder: a dance school, an agency, a shop and a veterinary practice
-- all reach Shadowing and then stop. A dance school telling a teacher their
-- class needs cover cannot use the governed send, though the mechanism, the
-- authority semantics, the receipt and the outcome separation would be
-- identical. That is the same defect shape migration 135 fixed one layer down.
--
-- WHAT CHANGES. The permitted effects become a declared vocabulary instead of a
-- literal, and capability drops out of the guard entirely — a responsibility's
-- capability must still equal its consent's capability, which is the invariant
-- that actually matters, but WHICH capability is no longer the boundary's
-- business.
--
-- WHAT DELIBERATELY DOES NOT CHANGE. The vocabulary stays CONSTITUTIONAL. A
-- company may declare what it counts (migration 135) because an observation is
-- evidence and reading it is harmless. A company may NOT declare a new
-- irreversible way to reach the outside world: effect kinds can only be added
-- by editing this migration, and migrations are inside the ring that ordinary
-- development authority cannot touch. The lesson from 135 is that closed
-- vocabularies are wrong when they encode a business assumption and right when
-- they encode a consequence boundary.
CREATE TABLE governed_effect_kinds (
  scope_key            TEXT PRIMARY KEY,
  action_type          TEXT NOT NULL,
  integration_name     TEXT NOT NULL,
  -- The consequence class a consent must have been granted at to use this. Not
  -- a minimum: an exact match, so widening consequence is never a side effect
  -- of adding an effect kind.
  consequence_boundary TEXT NOT NULL,
  -- What a founder is actually agreeing to when they grant this scope.
  description          TEXT NOT NULL
);

INSERT INTO governed_effect_kinds (scope_key, action_type, integration_name, consequence_boundary, description) VALUES
  ('send_email:support_reply', 'send_email', 'resend', 'low',
   'Send one founder-authored reply to the customer who wrote in, on this responsibility''s channel'),
  ('send_email:responsibility_notice', 'send_email', 'resend', 'low',
   'Send one founder-authored notice to a named recipient about this responsibility');

-- Constitutional: the vocabulary cannot be widened at runtime by anyone, which
-- is what stops a company, a model, or a compromised path from inventing a new
-- irreversible effect for itself.
CREATE TRIGGER governed_effect_kinds_immutable_insert
BEFORE INSERT ON governed_effect_kinds
BEGIN
  SELECT RAISE(ABORT,'governed_effect_kind:constitutional');
END;

CREATE TRIGGER governed_effect_kinds_immutable_update
BEFORE UPDATE ON governed_effect_kinds
BEGIN
  SELECT RAISE(ABORT,'governed_effect_kind:constitutional');
END;

CREATE TRIGGER governed_effect_kinds_immutable_delete
BEFORE DELETE ON governed_effect_kinds
BEGIN
  SELECT RAISE(ABORT,'governed_effect_kind:constitutional');
END;

-- Replaced in full. Every clause migration 114 enforced that was NOT the
-- support-specific binding is reproduced verbatim below — replacing a guard
-- means reproducing all of it, and the first draft of migration 135 proved how
-- easily a widening quietly drops something else.
DROP TRIGGER assisted_action_plan_guard;

CREATE TRIGGER assisted_action_plan_guard
BEFORE INSERT ON outbound_actions WHEN NEW.responsibility_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'assisted_action:binding_invalid')
  WHERE NEW.effect_id IS NULL OR NEW.authority_consent_id IS NULL
    -- The action, the integration and the scope must be one DECLARED effect
    -- kind, taken together. A caller cannot mix the action of one kind with the
    -- scope of another and land somewhere nobody authorised.
    OR NOT EXISTS (
      SELECT 1 FROM governed_effect_kinds k
      WHERE k.scope_key = NEW.authority_scope
        AND k.action_type = NEW.action_type
        AND k.integration_name = NEW.integration_name)
    OR NOT EXISTS (
      SELECT 1 FROM institutional_responsibilities r
      JOIN autonomy_consents a ON a.id=NEW.authority_consent_id
      JOIN governed_effect_kinds k ON k.scope_key=NEW.authority_scope
      WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id AND r.state='assisting'
        -- Capability is no longer named. What matters is that the
        -- responsibility and the consent agree about it, which is checked
        -- below exactly as before.
        AND r.authority_ref='autonomy_consent:' || a.id
        AND a.product_id=NEW.product_id AND a.responsibility_id=r.id AND a.capability=r.capability
        AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
        -- The consent must have been granted at exactly the consequence class
        -- this effect kind requires.
        AND a.consequence_boundary=k.consequence_boundary
        AND EXISTS (SELECT 1 FROM json_each(a.allowed_scope_json) WHERE value=NEW.authority_scope)
    );
END;
