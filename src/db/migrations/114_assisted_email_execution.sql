-- Extend the existing outbound action ledger with the minimum provenance and
-- truth needed for responsibility-bound assistance.  Provider receipt and
-- independently observed business outcome remain separate.
ALTER TABLE outbound_actions ADD COLUMN responsibility_id TEXT REFERENCES institutional_responsibilities(id);
ALTER TABLE outbound_actions ADD COLUMN authority_consent_id TEXT REFERENCES autonomy_consents(id);
ALTER TABLE outbound_actions ADD COLUMN authority_scope TEXT;
ALTER TABLE outbound_actions ADD COLUMN effect_id TEXT;
ALTER TABLE outbound_actions ADD COLUMN effect_certainty TEXT;
ALTER TABLE outbound_actions ADD COLUMN provider_receipt_json TEXT;
ALTER TABLE outbound_actions ADD COLUMN reconcile_after TEXT;
ALTER TABLE outbound_actions ADD COLUMN outcome_status TEXT;
ALTER TABLE outbound_actions ADD COLUMN outcome_evidence_ref TEXT;
ALTER TABLE outbound_actions ADD COLUMN learned_claim_id TEXT REFERENCES reconstruction_claims(id);
CREATE UNIQUE INDEX idx_assisted_effect_identity ON outbound_actions(product_id,effect_id) WHERE effect_id IS NOT NULL;
CREATE INDEX idx_assisted_responsibility ON outbound_actions(product_id,responsibility_id,created_at);

CREATE TRIGGER assisted_action_plan_guard
BEFORE INSERT ON outbound_actions WHEN NEW.responsibility_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'assisted_action:binding_invalid') WHERE NEW.action_type!='send_email' OR NEW.integration_name!='resend'
    OR NEW.authority_scope!='send_email:support_reply' OR NEW.effect_id IS NULL OR NEW.authority_consent_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM institutional_responsibilities r JOIN autonomy_consents a ON a.id=NEW.authority_consent_id
      WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id AND r.state='assisting'
        AND r.capability='customer_support' AND r.authority_ref='autonomy_consent:' || a.id
        AND a.product_id=NEW.product_id AND a.responsibility_id=r.id AND a.capability=r.capability
        AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now')
        AND a.consequence_boundary='low'
        AND EXISTS (SELECT 1 FROM json_each(a.allowed_scope_json) WHERE value=NEW.authority_scope)
    );
END;
