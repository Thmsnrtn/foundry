-- Extend the existing consent ledger; do not create a parallel permission
-- system. Legacy capability consent remains distinguishable and cannot satisfy
-- responsibility-bound Assisting authority.
ALTER TABLE autonomy_consents ADD COLUMN responsibility_id TEXT REFERENCES institutional_responsibilities(id);
ALTER TABLE autonomy_consents ADD COLUMN allowed_scope_json TEXT;
ALTER TABLE autonomy_consents ADD COLUMN consequence_boundary TEXT;
ALTER TABLE autonomy_consents ADD COLUMN expires_at TEXT;
CREATE INDEX idx_responsibility_authority ON autonomy_consents(product_id,responsibility_id,capability,revoked_at,expires_at);

CREATE TRIGGER responsibility_authority_guard
BEFORE INSERT ON autonomy_consents WHEN NEW.responsibility_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'responsibility_authority:invalid_binding') WHERE NEW.to_mode!='act' OR NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id AND r.capability=NEW.capability
      AND p.owner_id=NEW.founder_id AND r.state='shadowing'
  );
  SELECT RAISE(ABORT,'responsibility_authority:scope_required') WHERE
    NEW.allowed_scope_json IS NULL OR json_valid(NEW.allowed_scope_json)=0 OR json_array_length(NEW.allowed_scope_json)=0;
  SELECT RAISE(ABORT,'responsibility_authority:consequence_required') WHERE
    NEW.consequence_boundary IS NULL OR NEW.consequence_boundary NOT IN ('low','medium','high');
  SELECT RAISE(ABORT,'responsibility_authority:expiry_required') WHERE
    NEW.expires_at IS NULL OR datetime(NEW.expires_at)<=datetime('now');
END;
