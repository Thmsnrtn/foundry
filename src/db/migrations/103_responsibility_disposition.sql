-- Explicit owner decisions are the only source of deliberate non-action.
ALTER TABLE institutional_responsibilities ADD COLUMN disposition TEXT NOT NULL DEFAULT 'active'
  CHECK(disposition IN ('active','deliberately_not_done'));
ALTER TABLE institutional_responsibilities ADD COLUMN disposition_reason TEXT;
ALTER TABLE institutional_responsibilities ADD COLUMN disposition_evidence_ref TEXT;
ALTER TABLE institutional_responsibilities ADD COLUMN disposition_at DATETIME;

CREATE TABLE IF NOT EXISTS responsibility_dispositions (
  id TEXT PRIMARY KEY,
  responsibility_id TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  product_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('active','deliberately_not_done')),
  reason TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_responsibility_dispositions ON responsibility_dispositions(responsibility_id,created_at);

CREATE TRIGGER IF NOT EXISTS responsibility_disposition_guard
BEFORE INSERT ON responsibility_dispositions
BEGIN
  SELECT RAISE(ABORT, 'responsibility_disposition:not_found') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id AND p.owner_id=NEW.owner_id
  );
  SELECT RAISE(ABORT, 'responsibility_disposition:reason_required') WHERE trim(NEW.reason)='';
  SELECT RAISE(ABORT, 'responsibility_disposition:evidence_required') WHERE trim(NEW.evidence_ref)='';
END;

CREATE TRIGGER IF NOT EXISTS responsibility_disposition_apply
AFTER INSERT ON responsibility_dispositions
BEGIN
  UPDATE institutional_responsibilities SET disposition=NEW.disposition,
    disposition_reason=NEW.reason, disposition_evidence_ref=NEW.evidence_ref,
    disposition_at=NEW.created_at, updated_at=NEW.created_at
  WHERE id=NEW.responsibility_id AND product_id=NEW.product_id;
END;
