-- =============================================================================
-- A TRIGGER IS PREPARED, NOT INTERPRETED.
--
-- Migration 309 dropped `agent_wiki_entries`. `reconstruction_claim_guard`
-- (migration 106) names that table in one arm of the UNION that validates an
-- evidence reference of kind 'wiki_entry'. SQLite resolves a trigger body when
-- the statement that fires it is PREPARED, not when the branch is taken — so
-- every INSERT into `reconstruction_claims` would fail with
--
--     no such table: main.agent_wiki_entries
--
-- whether or not the claim cited a wiki entry at all.
--
-- That is not a test problem. `reconstruction_claims` is how the institution
-- records what it believes about a company and on what evidence; ten modules
-- under `services/institution/` write to it, and it is on the live path. The
-- deletion would have taken production's reconstruction machinery down at the
-- first claim after deploy.
--
-- THE GENERAL LESSON, which is why this is its own migration and not a line
-- appended to 309: dropping a table does not only orphan the code that reads
-- it. It orphans every SCHEMA OBJECT that names it — triggers, views, and any
-- CHECK that reaches outward — and those fail at prepare time, far from the
-- table you dropped, in statements that have nothing to do with it. The
-- writerless-table gate reads TypeScript. It cannot see a trigger body.
--
-- So the guard is recreated without the wiki arm, and 'wiki_entry' leaves the
-- allowed-kinds vocabulary with it: an evidence kind whose backing table does
-- not exist can never be satisfied, and a vocabulary entry that can only ever
-- ABORT is a trap, not a permission. Every other arm is carried across
-- unchanged, character for character, so this migration narrows the guard and
-- alters nothing else about it.
-- =============================================================================

DROP TRIGGER IF EXISTS reconstruction_claim_guard;

CREATE TRIGGER reconstruction_claim_guard
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
      json_extract(ref.value,'$.kind') NOT IN ('product','signal_event','integration','responsibility','authority_consent','action_execution')
      OR NOT EXISTS (
        SELECT 1 FROM products p WHERE json_extract(ref.value,'$.kind')='product'
          AND p.id=json_extract(ref.value,'$.id') AND p.id=NEW.product_id
        UNION ALL SELECT 1 FROM signal_events e WHERE json_extract(ref.value,'$.kind')='signal_event'
          AND e.id=json_extract(ref.value,'$.id') AND e.product_id=NEW.product_id
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
