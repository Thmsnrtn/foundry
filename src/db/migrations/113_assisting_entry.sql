-- Assisting is an authority-bearing state.  The generic transition ledger
-- cannot establish that a caller-provided authority reference is genuine, so
-- enforce the complete responsibility binding at the database boundary.
DROP TRIGGER responsibility_reference_guard;
CREATE TRIGGER responsibility_reference_guard
BEFORE INSERT ON responsibility_transitions
BEGIN
  SELECT RAISE(ABORT, 'responsibility_reference:evidence_invalid')
   WHERE NEW.evidence_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM signal_events e JOIN institutional_responsibilities r ON r.id=NEW.responsibility_id
     WHERE NEW.evidence_ref='signal_event:' || e.id AND e.product_id=r.product_id
    UNION ALL
    SELECT 1 FROM reconstruction_claims c JOIN institutional_responsibilities r ON r.id=NEW.responsibility_id
     WHERE NEW.evidence_ref='reconstruction_claim:' || c.id AND c.product_id=r.product_id
       AND c.epistemic_status IN ('known','inferred') AND json_array_length(c.evidence_refs_json)>0
       AND (c.valid_until IS NULL OR datetime(c.valid_until)>datetime('now'))
    UNION ALL
    SELECT 1 FROM responsibility_shadow_comparisons c
      JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
      JOIN institutional_responsibilities r ON r.id=x.responsibility_id
     WHERE NEW.evidence_ref='shadow_comparison:' || c.id AND r.id=NEW.responsibility_id
       AND c.product_id=r.product_id
  );
  SELECT RAISE(ABORT, 'responsibility_reference:authority_invalid')
   WHERE NEW.authority_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM autonomy_consents a JOIN institutional_responsibilities r ON r.id=NEW.responsibility_id
     WHERE NEW.authority_ref='autonomy_consent:' || a.id AND a.product_id=r.product_id
       AND a.capability=r.capability AND a.to_mode='act' AND a.revoked_at IS NULL
  );
  SELECT RAISE(ABORT, 'responsibility_reference:outcome_invalid')
   WHERE NEW.outcome_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM action_executions x JOIN institutional_responsibilities r ON r.id=NEW.responsibility_id
     WHERE NEW.outcome_ref='action_execution:' || x.id AND x.product_id=r.product_id
       AND x.status='completed' AND x.verify_status='passed'
  );
END;

CREATE TRIGGER responsibility_assisting_entry_guard
BEFORE INSERT ON responsibility_transitions WHEN NEW.to_state='assisting'
BEGIN
  SELECT RAISE(ABORT,'assisting:shadow_evidence_invalid') WHERE NOT EXISTS (
    SELECT 1
    FROM responsibility_shadow_comparisons c
    JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
    JOIN institutional_responsibilities r ON r.id=x.responsibility_id
    JOIN reconstruction_claims claim
      ON x.expectation_evidence_ref='reconstruction_claim:' || claim.id
    WHERE NEW.evidence_ref='shadow_comparison:' || c.id
      AND x.responsibility_id=NEW.responsibility_id
      AND r.state='shadowing'
      AND c.classification IN ('matched','deviated')
      AND claim.epistemic_status IN ('known','inferred')
      AND (claim.valid_until IS NULL OR datetime(claim.valid_until)>datetime('now'))
  );

  SELECT RAISE(ABORT,'assisting:authority_invalid') WHERE NOT EXISTS (
    SELECT 1
    FROM autonomy_consents a
    JOIN institutional_responsibilities r ON r.id=a.responsibility_id
    WHERE NEW.authority_ref='autonomy_consent:' || a.id
      AND a.responsibility_id=NEW.responsibility_id
      AND a.product_id=r.product_id
      AND a.capability=r.capability
      AND a.to_mode='act'
      AND a.revoked_at IS NULL
      AND datetime(a.expires_at)>datetime('now')
      AND json_valid(a.allowed_scope_json)=1
      AND json_array_length(a.allowed_scope_json)>0
  );
END;
