-- Responsibility references must resolve to same-product canonical ledgers.
ALTER TABLE institutional_responsibilities ADD COLUMN capability TEXT NOT NULL DEFAULT 'general';

CREATE TRIGGER IF NOT EXISTS responsibility_reference_guard
BEFORE INSERT ON responsibility_transitions
BEGIN
  SELECT RAISE(ABORT, 'responsibility_reference:evidence_invalid')
   WHERE NEW.evidence_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM signal_events e JOIN institutional_responsibilities r ON r.id=NEW.responsibility_id
     WHERE NEW.evidence_ref='signal_event:' || e.id AND e.product_id=r.product_id
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

CREATE TRIGGER IF NOT EXISTS responsibility_disposition_evidence_guard
BEFORE INSERT ON responsibility_dispositions
BEGIN
  SELECT RAISE(ABORT, 'responsibility_disposition:evidence_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e
     WHERE NEW.evidence_ref='signal_event:' || e.id AND e.product_id=NEW.product_id
  );
END;
