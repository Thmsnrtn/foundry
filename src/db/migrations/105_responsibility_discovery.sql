-- Idempotent provenance link from company evidence to discovered responsibility.
ALTER TABLE institutional_responsibilities ADD COLUMN discovery_evidence_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_responsibility_discovery_evidence
  ON institutional_responsibilities(product_id, discovery_evidence_ref)
  WHERE discovery_evidence_ref IS NOT NULL;
