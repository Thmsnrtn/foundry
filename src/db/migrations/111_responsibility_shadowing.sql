-- Non-executing expectations and comparisons. Actual observations remain in
-- their canonical ledgers; this table records only the bounded comparison.
CREATE TABLE responsibility_shadow_expectations (
  id TEXT PRIMARY KEY,
  responsibility_id TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  product_id TEXT NOT NULL,
  expected_event_type TEXT NOT NULL,
  expectation_evidence_ref TEXT NOT NULL,
  observation_source_evidence_ref TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE responsibility_shadow_comparisons (
  id TEXT PRIMARY KEY,
  expectation_id TEXT NOT NULL REFERENCES responsibility_shadow_expectations(id),
  product_id TEXT NOT NULL,
  observation_ref TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('matched','deviated','unresolved')),
  learned_claim_id TEXT REFERENCES reconstruction_claims(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(expectation_id,observation_ref)
);

CREATE TRIGGER responsibility_shadow_expectation_guard
BEFORE INSERT ON responsibility_shadow_expectations
BEGIN
  SELECT RAISE(ABORT,'shadowing:responsibility_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r WHERE r.id=NEW.responsibility_id
      AND r.product_id=NEW.product_id AND r.state='understood' AND r.authority_ref IS NULL
  );
  SELECT RAISE(ABORT,'shadowing:expectation_evidence_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM reconstruction_claims c WHERE NEW.expectation_evidence_ref='reconstruction_claim:' || c.id
      AND c.product_id=NEW.product_id AND c.epistemic_status IN ('known','inferred')
      AND json_array_length(c.evidence_refs_json)>0 AND (c.valid_until IS NULL OR datetime(c.valid_until)>datetime('now'))
  );
  SELECT RAISE(ABORT,'shadowing:observation_source_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e WHERE NEW.observation_source_evidence_ref='signal_event:' || e.id
      AND e.product_id=NEW.product_id
  );
END;

CREATE TRIGGER responsibility_shadow_comparison_guard
BEFORE INSERT ON responsibility_shadow_comparisons
BEGIN
  SELECT RAISE(ABORT,'shadowing:expectation_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_shadow_expectations x JOIN institutional_responsibilities r ON r.id=x.responsibility_id
      WHERE x.id=NEW.expectation_id AND x.product_id=NEW.product_id AND r.state='shadowing' AND r.authority_ref IS NULL
  );
  SELECT RAISE(ABORT,'shadowing:observation_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e WHERE NEW.observation_ref='signal_event:' || e.id AND e.product_id=NEW.product_id
  );
  SELECT RAISE(ABORT,'shadowing:learning_invalid') WHERE NEW.learned_claim_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM reconstruction_claims c WHERE c.id=NEW.learned_claim_id AND c.product_id=NEW.product_id
      AND json_array_length(c.evidence_refs_json)>0
  );
END;
