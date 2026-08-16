-- Migration 122: a plan may only exist because building was the right answer.
--
-- A development institution that can only build is not a development
-- institution. Investigating, configuring, deleting, deferring, and doing
-- nothing are correct answers, and they must be able to stop a change rather
-- than merely be describable.
--
-- Recording the disposition on the plan keeps that gate load-bearing: without
-- a `change` disposition and the evidence that grounded it, there is no plan.
ALTER TABLE development_change_plans ADD COLUMN disposition TEXT;
ALTER TABLE development_change_plans ADD COLUMN disposition_evidence_json TEXT;

CREATE TRIGGER development_change_disposition_guard
BEFORE INSERT ON development_change_plans
BEGIN
  SELECT RAISE(ABORT,'development_change:disposition_invalid') WHERE
    NEW.disposition IS NOT 'change'
    OR NEW.disposition_evidence_json IS NULL
    OR json_valid(NEW.disposition_evidence_json)=0
    OR json_array_length(NEW.disposition_evidence_json)=0;

  -- The grounding must be this product's own current claims. A disposition
  -- justified by another tenant's evidence is not a justification.
  SELECT RAISE(ABORT,'development_change:disposition_evidence_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.disposition_evidence_json) e
    WHERE NOT EXISTS (
      SELECT 1 FROM reconstruction_claims c
      WHERE c.id=e.value AND c.product_id=NEW.product_id
        AND c.epistemic_status IN ('known','inferred')
        AND (c.valid_until IS NULL OR datetime(c.valid_until)>datetime('now'))
    )
  );
END;
