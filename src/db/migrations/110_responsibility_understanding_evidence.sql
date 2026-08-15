-- Reuse current, canonically grounded reconstruction claims as responsibility
-- transition evidence instead of creating a duplicate understanding store.
DROP TRIGGER IF EXISTS responsibility_reference_guard;
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
