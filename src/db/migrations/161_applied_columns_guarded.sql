-- =============================================================================
-- Migration 161: the rest of the doors beside the rules
--
-- A gate written to stop migrations 159 and 160's defect from recurring found
-- six more of it the first time it ran. The pattern: a LEDGER records what
-- happened, guarded on insert by everything that makes the record trustworthy,
-- and an AFTER INSERT trigger APPLIES the result to a column on a parent row —
-- while the applied column stays a plain column anything can write.
--
-- 1. `responsibility_candidates.status`
--
-- A candidate becomes a real responsibility when the founder promotes it, and
-- `responsibility_candidate_lifecycle_guard` is where that means something: the
-- decision must carry `grounding_mechanism='authenticated_owner'` and an
-- `actor_ref` that matches the company's actual owner. A plain
--
--   UPDATE responsibility_candidates SET status = 'promoted'
--
-- promotes it with no founder anywhere near the decision. That is not a missing
-- audit trail, it is a missing authorisation.
--
-- 2. `institutional_responsibilities.evidence_ref / authority_ref / outcome_ref`
--
-- These are the PROOF behind the current state: which observation justified it,
-- which consent authorises acting on it, which execution settled it.
-- `responsibility_reference_guard` checks every one of them on the transition
-- ledger — that the evidence names a signal event or claim belonging to this
-- company, that the authority names a live act-consent for this
-- responsibility's own capability, that the outcome names a completed and
-- verified execution. None of it applied to the row.
--
-- These are guarded DIFFERENTLY from `state` and `disposition`, and the
-- difference is the point. A re-grant legitimately replaces `authority_ref`
-- WITHOUT a state change — a responsibility already Assisting is not re-admitted
-- when its permission is renewed, and the transition ledger would refuse an
-- assisting->assisting move as a no-change. So requiring a transition here would
-- break a real path. What must hold is not "a ledger moved this" but "the thing
-- it names is real and still valid", which is exactly what the reference guard
-- says on the other side.
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS responsibility_candidate_status_requires_decision
BEFORE UPDATE OF status ON responsibility_candidates
WHEN NEW.status IS NOT OLD.status
BEGIN
  -- The decision and the status it produces are not the same word for one of
  -- the four: 'reconsidered' returns a candidate to 'pending'. Spelled out
  -- rather than assumed equal, because assuming it is how a guard ends up
  -- refusing the legitimate path — the apply trigger below it does exactly this
  -- mapping.
  SELECT RAISE(ABORT, 'candidate_status:no_decision') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_candidate_decisions d
     WHERE d.candidate_id = NEW.id
       AND d.product_id = NEW.product_id
       AND NEW.status = CASE d.decision
             WHEN 'reconsidered' THEN 'pending'
             ELSE d.decision
           END
  );
END;

CREATE TRIGGER IF NOT EXISTS responsibility_reference_columns_guard
BEFORE UPDATE OF evidence_ref, authority_ref, outcome_ref
ON institutional_responsibilities
WHEN NEW.evidence_ref IS NOT OLD.evidence_ref
  OR NEW.authority_ref IS NOT OLD.authority_ref
  OR NEW.outcome_ref IS NOT OLD.outcome_ref
BEGIN
  SELECT RAISE(ABORT, 'responsibility_reference:evidence_invalid')
   WHERE NEW.evidence_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM signal_events e
     WHERE NEW.evidence_ref = 'signal_event:' || e.id AND e.product_id = NEW.product_id
    UNION ALL
    SELECT 1 FROM reconstruction_claims c
     WHERE NEW.evidence_ref = 'reconstruction_claim:' || c.id AND c.product_id = NEW.product_id
       AND c.epistemic_status IN ('known','inferred') AND json_array_length(c.evidence_refs_json) > 0
       AND (c.valid_until IS NULL OR datetime(c.valid_until) > datetime('now'))
    UNION ALL
    SELECT 1 FROM responsibility_shadow_comparisons c
      JOIN responsibility_shadow_expectations x ON x.id = c.expectation_id
     WHERE NEW.evidence_ref = 'shadow_comparison:' || c.id
       AND x.responsibility_id = NEW.id AND c.product_id = NEW.product_id
  );

  SELECT RAISE(ABORT, 'responsibility_reference:authority_invalid')
   WHERE NEW.authority_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM autonomy_consents a
     WHERE NEW.authority_ref = 'autonomy_consent:' || a.id AND a.product_id = NEW.product_id
       AND a.capability = NEW.capability AND a.to_mode = 'act' AND a.revoked_at IS NULL
  );

  SELECT RAISE(ABORT, 'responsibility_reference:outcome_invalid')
   WHERE NEW.outcome_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM action_executions x
     WHERE NEW.outcome_ref = 'action_execution:' || x.id AND x.product_id = NEW.product_id
       AND x.status = 'completed' AND x.verify_status = 'passed'
  );
END;

-- 3. `institutional_responsibilities.disposition_at`
--
-- The timestamp of the disposition, applied by the same trigger and left out of
-- migration 160's column list. It is part of the record rather than generic
-- bookkeeping: a disposition whose date can be moved independently is one whose
-- place in the seven-day summary can be moved. Rebuilt rather than extended,
-- because SQLite has no ALTER TRIGGER.

DROP TRIGGER IF EXISTS responsibility_disposition_requires_record;

CREATE TRIGGER responsibility_disposition_requires_record
BEFORE UPDATE OF disposition, disposition_reason, disposition_evidence_ref, disposition_at
ON institutional_responsibilities
WHEN NEW.disposition IS NOT OLD.disposition
  OR NEW.disposition_reason IS NOT OLD.disposition_reason
  OR NEW.disposition_evidence_ref IS NOT OLD.disposition_evidence_ref
  OR NEW.disposition_at IS NOT OLD.disposition_at
BEGIN
  SELECT RAISE(ABORT, 'responsibility_disposition:no_record') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_dispositions d
     WHERE d.responsibility_id = NEW.id
       AND d.product_id = NEW.product_id
       AND d.disposition = NEW.disposition
       AND d.reason = NEW.disposition_reason
       AND d.evidence_ref = NEW.disposition_evidence_ref
       AND d.created_at = NEW.disposition_at
  );
END;
