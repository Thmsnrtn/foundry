-- Migration 128: close a NULL trap in migration 124's judgment observation
-- guard.
--
-- Found while writing the equivalent guard for external observations. In
-- SQLite, `json_type(payload,'$.missing_key')` is NULL, and `NULL <> 'array'`
-- is NULL, not true. A RAISE guarded by an OR chain containing only false and
-- NULL terms therefore does not fire — so the guard accepted exactly the
-- payload it was written to refuse: a judgment observation with **no evidence
-- at all**, claiming an expectation was supported.
--
-- Nothing in the codebase produced such a payload (the observation pass always
-- cites the claims it read), and the strictly-later-evidence check silently
-- passed too, because `json_each` over a missing key yields no rows and an
-- EXISTS over nothing is false. The hole was reachable only by a hand-written
-- insert — which is precisely the adversarial case a guard exists for.
--
-- Every absence is now coalesced before comparison. The trigger is otherwise
-- identical to migration 124's.
DROP TRIGGER IF EXISTS institutional_judgment_observation_guard;

CREATE TRIGGER institutional_judgment_observation_guard
BEFORE INSERT ON signal_events WHEN NEW.source='institutional_judgment_observation'
BEGIN
  SELECT RAISE(ABORT,'judgment_observation:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.judgment_id'),''))=''
    OR coalesce(json_type(NEW.payload_json,'$.evidence_claim_ids'),'absent')<>'array'
    OR coalesce(json_array_length(NEW.payload_json,'$.evidence_claim_ids'),0)=0;

  SELECT RAISE(ABORT,'judgment_observation:circular_grounding') WHERE
    json_extract(NEW.payload_json,'$.expected_outcome') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.alternatives_considered') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.conflict_identity') IS NOT NULL;

  SELECT RAISE(ABORT,'judgment_observation:judgment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM strategic_decisions_log d
    WHERE d.id=json_extract(NEW.payload_json,'$.judgment_id')
      AND d.product_id=NEW.product_id AND d.responsibility_refs_json IS NOT NULL);

  SELECT RAISE(ABORT,'judgment_observation:evidence_not_later') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.payload_json,'$.evidence_claim_ids') c
    WHERE NOT EXISTS (
      SELECT 1 FROM reconstruction_claims rc, strategic_decisions_log d
      WHERE rc.id=c.value AND rc.product_id=NEW.product_id
        AND d.id=json_extract(NEW.payload_json,'$.judgment_id')
        AND datetime(rc.created_at)>datetime(d.made_at)));
END;
