-- Non-executable possible responsibilities. A candidate grants nothing.
CREATE TABLE IF NOT EXISTS responsibility_candidates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  convergence_key TEXT NOT NULL,
  proposed_responsibility TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  derivation_method TEXT NOT NULL,
  rationale TEXT NOT NULL,
  epistemic_status TEXT NOT NULL CHECK(epistemic_status IN ('known','inferred','unresolved')),
  confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  proposed_owner_ref TEXT,
  capability_dependency TEXT,
  authority_required INTEGER NOT NULL DEFAULT 0 CHECK(authority_required IN (0,1)),
  observed_at TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rejected','superseded','promoted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id,convergence_key)
);

CREATE TRIGGER responsibility_candidate_guard BEFORE INSERT ON responsibility_candidates BEGIN
  SELECT RAISE(ABORT,'responsibility_candidate:required') WHERE
    trim(NEW.convergence_key)='' OR trim(NEW.proposed_responsibility)='' OR
    trim(NEW.derivation_method)='' OR trim(NEW.rationale)='';
  SELECT RAISE(ABORT,'responsibility_candidate:evidence_required') WHERE
    json_valid(NEW.evidence_refs_json)=0 OR json_type(NEW.evidence_refs_json)!='array' OR json_array_length(NEW.evidence_refs_json)=0;
  SELECT RAISE(ABORT,'responsibility_candidate:confidence_required') WHERE
    NEW.epistemic_status='inferred' AND NEW.confidence IS NULL;
  SELECT RAISE(ABORT,'responsibility_candidate:evidence_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.evidence_refs_json) ref WHERE
      json_extract(ref.value,'$.kind') NOT IN ('signal_event','reconstruction_claim') OR NOT EXISTS (
        SELECT 1 FROM signal_events e WHERE json_extract(ref.value,'$.kind')='signal_event'
          AND e.id=json_extract(ref.value,'$.id') AND e.product_id=NEW.product_id
        UNION ALL
        SELECT 1 FROM reconstruction_claims c WHERE json_extract(ref.value,'$.kind')='reconstruction_claim'
          AND c.id=json_extract(ref.value,'$.id') AND c.product_id=NEW.product_id
          AND json_array_length(c.evidence_refs_json)>0
          AND (NEW.epistemic_status='unresolved' OR (
            c.epistemic_status IN ('known','inferred') AND (c.valid_until IS NULL OR datetime(c.valid_until)>datetime('now'))
          ))
      )
  );
END;

CREATE INDEX idx_responsibility_candidates_product_status
  ON responsibility_candidates(product_id,status,created_at);
