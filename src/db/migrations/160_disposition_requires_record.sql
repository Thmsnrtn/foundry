-- =============================================================================
-- Migration 160: the same door, on the other column
--
-- Migration 159 closed the direct write to `institutional_responsibilities.state`.
-- The row carries a second governed field with exactly the same shape, and the
-- same door beside it.
--
-- "Deliberately not done" is the institution's record that the founder LOOKED at
-- something and chose not to act — it is what the seven-day absence summary
-- reports, and the whole reason that summary can distinguish neglect from a
-- decision. Recording it goes through `responsibility_dispositions`, whose
-- guards require three things: the acting owner must actually own the company,
-- the reason must be non-empty, and the evidence must name a signal event this
-- company really recorded.
--
-- A plain
--
--   UPDATE institutional_responsibilities SET disposition = 'deliberately_not_done'
--
-- satisfies none of them, and leaves nothing in the disposition ledger to show
-- who decided or why. So does quietly editing `disposition_reason` or
-- `disposition_evidence_ref` afterwards, which is the more interesting attack:
-- it rewrites the JUSTIFICATION for a decision that was properly made.
--
-- All three columns are therefore guarded together, and the justification has to
-- match the values being written — not merely exist. `responsibility_disposition_apply`
-- runs AFTER the ledger insert, so the legitimate path passes.
--
-- `IS NOT` rather than `<>` for the change test: these columns are NULL until
-- the first disposition, and `NULL <> 'x'` is NULL, which would let the very
-- first write through unguarded. That is the three-valued trap this codebase has
-- been bitten by repeatedly, and it is the one that matters here — the first
-- write is the one that invents a judgement nobody made.
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS responsibility_disposition_requires_record
BEFORE UPDATE OF disposition, disposition_reason, disposition_evidence_ref
ON institutional_responsibilities
WHEN NEW.disposition IS NOT OLD.disposition
  OR NEW.disposition_reason IS NOT OLD.disposition_reason
  OR NEW.disposition_evidence_ref IS NOT OLD.disposition_evidence_ref
BEGIN
  SELECT RAISE(ABORT, 'responsibility_disposition:no_record') WHERE NOT EXISTS (
    SELECT 1 FROM responsibility_dispositions d
     WHERE d.responsibility_id = NEW.id
       AND d.product_id = NEW.product_id
       AND d.disposition = NEW.disposition
       AND d.reason = NEW.disposition_reason
       AND d.evidence_ref = NEW.disposition_evidence_ref
  );
END;
