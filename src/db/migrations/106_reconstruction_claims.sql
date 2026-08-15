-- Interpretive company claims only. Canonical facts stay in their owning ledgers.
CREATE TABLE IF NOT EXISTS reconstruction_claims (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value_json TEXT,
  epistemic_status TEXT NOT NULL CHECK(epistemic_status IN ('known','inferred','unknown','conflicting','stale')),
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  derivation_method TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reconstruction_claims_product_subject
  ON reconstruction_claims(product_id,subject,predicate,created_at DESC);

CREATE TRIGGER IF NOT EXISTS reconstruction_claim_guard
BEFORE INSERT ON reconstruction_claims
BEGIN
  SELECT RAISE(ABORT,'reconstruction_claim:subject_required') WHERE trim(NEW.subject)='';
  SELECT RAISE(ABORT,'reconstruction_claim:predicate_required') WHERE trim(NEW.predicate)='';
  SELECT RAISE(ABORT,'reconstruction_claim:derivation_required') WHERE trim(NEW.derivation_method)='';
  SELECT RAISE(ABORT,'reconstruction_claim:evidence_json_invalid')
    WHERE json_valid(NEW.evidence_refs_json)=0 OR json_type(NEW.evidence_refs_json)!='array';
  SELECT RAISE(ABORT,'reconstruction_claim:value_required')
    WHERE NEW.epistemic_status!='unknown' AND NEW.value_json IS NULL;
  SELECT RAISE(ABORT,'reconstruction_claim:unknown_has_value')
    WHERE NEW.epistemic_status='unknown' AND NEW.value_json IS NOT NULL;
  SELECT RAISE(ABORT,'reconstruction_claim:evidence_required')
    WHERE NEW.epistemic_status!='unknown' AND json_array_length(NEW.evidence_refs_json)=0;
  SELECT RAISE(ABORT,'reconstruction_claim:conflict_requires_multiple_sources')
    WHERE NEW.epistemic_status='conflicting' AND json_array_length(NEW.evidence_refs_json)<2;
  SELECT RAISE(ABORT,'reconstruction_claim:inference_confidence_required')
    WHERE NEW.epistemic_status='inferred' AND NEW.confidence IS NULL;
  SELECT RAISE(ABORT,'reconstruction_claim:evidence_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.evidence_refs_json) ref WHERE
      json_extract(ref.value,'$.kind') NOT IN ('product','signal_event','wiki_entry','integration','responsibility','authority_consent','action_execution')
      OR NOT EXISTS (
        SELECT 1 FROM products p WHERE json_extract(ref.value,'$.kind')='product'
          AND p.id=json_extract(ref.value,'$.id') AND p.id=NEW.product_id
        UNION ALL SELECT 1 FROM signal_events e WHERE json_extract(ref.value,'$.kind')='signal_event'
          AND e.id=json_extract(ref.value,'$.id') AND e.product_id=NEW.product_id
        UNION ALL SELECT 1 FROM agent_wiki_entries w WHERE json_extract(ref.value,'$.kind')='wiki_entry'
          AND w.id=json_extract(ref.value,'$.id') AND w.product_id=NEW.product_id
        UNION ALL SELECT 1 FROM integrations i WHERE json_extract(ref.value,'$.kind')='integration'
          AND i.id=json_extract(ref.value,'$.id') AND i.product_id=NEW.product_id
        UNION ALL SELECT 1 FROM institutional_responsibilities r WHERE json_extract(ref.value,'$.kind')='responsibility'
          AND r.id=json_extract(ref.value,'$.id') AND r.product_id=NEW.product_id
        UNION ALL SELECT 1 FROM autonomy_consents a WHERE json_extract(ref.value,'$.kind')='authority_consent'
          AND a.id=json_extract(ref.value,'$.id') AND a.product_id=NEW.product_id
        UNION ALL SELECT 1 FROM action_executions x WHERE json_extract(ref.value,'$.kind')='action_execution'
          AND x.id=json_extract(ref.value,'$.id') AND x.product_id=NEW.product_id
      )
  );
END;
