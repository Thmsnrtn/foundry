-- Append-only comparisons preserve the original judgment-time snapshot.
CREATE TABLE institutional_judgment_evaluations (
 id TEXT PRIMARY KEY, judgment_id TEXT NOT NULL REFERENCES strategic_decisions_log(id), product_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('not_yet_observable','insufficient_evidence','partially_observed','supported','contradicted','mixed','conflicting')),
 evidence_refs_json TEXT NOT NULL, economic_result_json TEXT NOT NULL, learned_claim_id TEXT REFERENCES reconstruction_claims(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_judgment_evaluations ON institutional_judgment_evaluations(product_id,judgment_id,created_at);
CREATE TRIGGER institutional_judgment_evaluation_guard BEFORE INSERT ON institutional_judgment_evaluations BEGIN
 SELECT RAISE(ABORT,'judgment_evaluation:tenant_invalid') WHERE NOT EXISTS (
  SELECT 1 FROM strategic_decisions_log d WHERE d.id=NEW.judgment_id AND d.product_id=NEW.product_id);
 SELECT RAISE(ABORT,'judgment_evaluation:evidence_invalid') WHERE json_valid(NEW.evidence_refs_json)=0 OR EXISTS (
  SELECT 1 FROM json_each(NEW.evidence_refs_json) refs WHERE NOT EXISTS (
   SELECT 1 FROM signal_events s WHERE refs.value='signal_event:'||s.id AND s.product_id=NEW.product_id));
END;
