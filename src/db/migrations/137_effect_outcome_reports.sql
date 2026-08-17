-- Migration 137: somebody outside can finally say whether it worked.
--
-- THE GAP. The canonical loop ends
--
--   … → Execution → Receipt → Outcome → Learning
--
-- and the last two links had no supply. `reconcileAssistedSupportEmail` looks
-- for `support_reply_effective` / `support_reply_failed` signals, and NOTHING
-- in production has ever produced one. So `outcome_status` was permanently
-- `unresolved`, reconciliation could only ever return `unresolved`, and the
-- seven-day view's "I did something here and nobody knows yet whether it
-- actually worked" was permanently true by construction rather than by fact.
--
-- That is the correct default and a poor destination. Preserving `unresolved`
-- was always right; being UNABLE to leave it means the institution can act and
-- can never learn.
--
-- WHAT THIS ADDS. A report, from someone who is not Foundry, that a specific
-- executed effect did or did not achieve what it was for. Two sources are
-- legitimate and both are recorded as what they are:
--
--   • the authenticated owner, who usually knows and whose word is
--     provenance-bearing evidence — not proof, and labelled as their claim;
--   • an outside system posting to the ordinary tenant-bound intake.
--
-- WHAT THIS IS NOT. It is not proof, and it is not Foundry's opinion. The
-- guard below refuses any report attributed to the institution: a system that
-- can declare its own success has no outcome layer at all, only a louder
-- execution layer. Conflicting reports are preserved as conflicting rather than
-- resolved toward the convenient one, and an effect that never executed cannot
-- have an outcome at all.
CREATE TRIGGER effect_outcome_report_guard
BEFORE INSERT ON signal_events WHEN NEW.source='effect_outcome_report'
BEGIN
  -- Every absence is coalesced. `X NOT IN (...)` is NULL when X is missing, and
  -- a NULL condition never fires a RAISE — the recurring way an absent field
  -- walks past a guard in this schema.
  SELECT RAISE(ABORT,'effect_outcome:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.effect_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.reporter'),''))=''
    OR coalesce(json_extract(NEW.payload_json,'$.verdict'),'absent') NOT IN ('achieved','failed');

  -- Foundry may not report on itself. Doing the thing is not evidence that the
  -- thing worked, and this is exactly where that would be easiest to fudge.
  SELECT RAISE(ABORT,'effect_outcome:self_reported')
  WHERE coalesce(json_extract(NEW.payload_json,'$.reporter'),'') LIKE 'institution:%';

  -- The effect must be this company's own, and must have actually executed. An
  -- outcome for something that never happened is not an outcome; a plan that
  -- was refused or revoked has no result to report.
  SELECT RAISE(ABORT,'effect_outcome:effect_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM outbound_actions o
    WHERE o.product_id=NEW.product_id
      AND o.effect_id=coalesce(json_extract(NEW.payload_json,'$.effect_id'),'')
      AND o.status='executed');

  -- The event type is derived from the report, so a later comparison matches on
  -- what was reported rather than on a label the caller chose.
  SELECT RAISE(ABORT,'effect_outcome:event_type_mismatch')
  WHERE NEW.event_type <> 'effect_outcome:'
    || json_extract(NEW.payload_json,'$.effect_id') || ':'
    || json_extract(NEW.payload_json,'$.verdict');
END;

CREATE INDEX idx_effect_outcome_reports
  ON signal_events(product_id, source, created_at);
