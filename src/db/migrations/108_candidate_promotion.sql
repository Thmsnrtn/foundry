-- Append-only institutional decisions about possible responsibilities.
CREATE TABLE IF NOT EXISTS responsibility_candidate_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES responsibility_candidates(id),
  product_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('promoted','rejected','superseded','reconsidered')),
  grounding_mechanism TEXT NOT NULL CHECK(grounding_mechanism IN ('deterministic','authenticated_owner')),
  grounding_evidence_json TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  resulting_responsibility_id TEXT REFERENCES institutional_responsibilities(id),
  resulting_initial_state TEXT CHECK(resulting_initial_state IS NULL OR resulting_initial_state='visible'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_candidate_single_promotion
  ON responsibility_candidate_decisions(candidate_id) WHERE decision='promoted';

CREATE TRIGGER responsibility_candidate_promotion_guard
BEFORE INSERT ON responsibility_candidate_decisions WHEN NEW.decision='promoted'
BEGIN
  SELECT RAISE(ABORT,'candidate_promotion:not_promotable') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_candidates c WHERE c.id=NEW.candidate_id AND c.product_id=NEW.product_id
      AND c.status='pending' AND c.epistemic_status!='unresolved'
      AND (c.valid_until IS NULL OR datetime(c.valid_until)>datetime('now'))
      AND c.evidence_refs_json=NEW.grounding_evidence_json
  );
  SELECT RAISE(ABORT,'candidate_promotion:result_required') WHERE
    NEW.resulting_responsibility_id IS NULL OR NEW.resulting_initial_state!='visible';
  SELECT RAISE(ABORT,'candidate_promotion:owner_invalid') WHERE
    NEW.grounding_mechanism='authenticated_owner' AND NOT EXISTS (
      SELECT 1 FROM products p WHERE p.id=NEW.product_id AND ('founder:' || p.owner_id)=NEW.actor_ref
    );
  SELECT RAISE(ABORT,'candidate_promotion:deterministic_invalid') WHERE
    NEW.grounding_mechanism='deterministic' AND (
      NEW.actor_ref!='institution:deterministic_candidate_grounder' OR NOT EXISTS (
        SELECT 1 FROM responsibility_candidates c WHERE c.id=NEW.candidate_id AND c.epistemic_status='known'
      )
    );
  -- Re-resolve every source at decision time. Positive claim evidence must
  -- still be current, non-conflicting, and canonically grounded.
  SELECT RAISE(ABORT,'candidate_promotion:evidence_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.grounding_evidence_json) ref WHERE NOT EXISTS (
      SELECT 1 FROM signal_events e WHERE json_extract(ref.value,'$.kind')='signal_event'
        AND e.id=json_extract(ref.value,'$.id') AND e.product_id=NEW.product_id
      UNION ALL SELECT 1 FROM reconstruction_claims c WHERE json_extract(ref.value,'$.kind')='reconstruction_claim'
        AND c.id=json_extract(ref.value,'$.id') AND c.product_id=NEW.product_id
        AND c.epistemic_status IN ('known','inferred') AND json_array_length(c.evidence_refs_json)>0
        AND (c.valid_until IS NULL OR datetime(c.valid_until)>datetime('now'))
    )
  );
END;

CREATE TRIGGER responsibility_candidate_promotion_apply
AFTER INSERT ON responsibility_candidate_decisions WHEN NEW.decision='promoted'
BEGIN
  UPDATE responsibility_candidates SET status='promoted',updated_at=NEW.created_at
    WHERE id=NEW.candidate_id AND status='pending';
END;
