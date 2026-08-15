-- Minimal append-only lifecycle for responsibility candidates. Current status is
-- only a projection of decisions; history remains authoritative.
ALTER TABLE responsibility_candidate_decisions ADD COLUMN superseded_by_candidate_id TEXT REFERENCES responsibility_candidates(id);

CREATE TRIGGER responsibility_candidate_lifecycle_guard
BEFORE INSERT ON responsibility_candidate_decisions WHEN NEW.decision!='promoted'
BEGIN
  SELECT RAISE(ABORT,'candidate_decision:result_not_allowed') WHERE
    NEW.resulting_responsibility_id IS NOT NULL OR NEW.resulting_initial_state IS NOT NULL;
  SELECT RAISE(ABORT,'candidate_decision:owner_invalid') WHERE
    NEW.grounding_mechanism!='authenticated_owner' OR NOT EXISTS (
      SELECT 1 FROM products p WHERE p.id=NEW.product_id AND ('founder:' || p.owner_id)=NEW.actor_ref
    );
  SELECT RAISE(ABORT,'candidate_decision:candidate_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_candidates c WHERE c.id=NEW.candidate_id AND c.product_id=NEW.product_id
  );
  SELECT RAISE(ABORT,'candidate_decision:not_pending') WHERE NEW.decision IN ('rejected','superseded') AND NOT EXISTS (
    SELECT 1 FROM responsibility_candidates c WHERE c.id=NEW.candidate_id AND c.status='pending'
  );
  SELECT RAISE(ABORT,'candidate_decision:not_reconsiderable') WHERE NEW.decision='reconsidered' AND NOT EXISTS (
    SELECT 1 FROM responsibility_candidates c WHERE c.id=NEW.candidate_id AND c.status IN ('rejected','superseded')
  );
  SELECT RAISE(ABORT,'candidate_decision:superseding_candidate_invalid') WHERE NEW.decision='superseded' AND NOT EXISTS (
    SELECT 1 FROM responsibility_candidates old
    JOIN responsibility_candidates replacement ON replacement.id=NEW.superseded_by_candidate_id
    WHERE old.id=NEW.candidate_id AND replacement.product_id=old.product_id
      AND replacement.id!=old.id AND replacement.status='pending'
  );
  SELECT RAISE(ABORT,'candidate_decision:superseder_not_allowed') WHERE
    NEW.decision!='superseded' AND NEW.superseded_by_candidate_id IS NOT NULL;
END;

CREATE TRIGGER responsibility_candidate_lifecycle_apply
AFTER INSERT ON responsibility_candidate_decisions WHEN NEW.decision!='promoted'
BEGIN
  UPDATE responsibility_candidates SET status='rejected',updated_at=NEW.created_at
    WHERE id=NEW.candidate_id AND NEW.decision='rejected';
  UPDATE responsibility_candidates SET status='superseded',updated_at=NEW.created_at
    WHERE id=NEW.candidate_id AND NEW.decision='superseded';
  UPDATE responsibility_candidates SET status='pending',updated_at=NEW.created_at
    WHERE id=NEW.candidate_id AND NEW.decision='reconsidered';
END;
