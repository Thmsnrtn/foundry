-- =============================================================================
-- THE THREAD HEARS WHAT HAPPENED
--
-- An undertaking's steps reference the rows they rest on: the situation that
-- was read, the advice that was raised, the sense that was missing, the act
-- that was proposed inside it. When one of those rows changes — the situation
-- ends, the advice is decided, the sense connects and first reports, the act
-- is used — the thread it belongs to hears it, by that reference and no other.
-- Nothing attaches to a thread for sharing a company with it.
--
-- This is the index that makes "which open threads reference this row" a
-- lookup rather than a scan. No column changes.
-- =============================================================================
CREATE INDEX idx_undertaking_steps_by_ref ON undertaking_steps(ref_kind, ref_id)
  WHERE ref_id IS NOT NULL;
CREATE INDEX idx_undertakings_opened_from ON undertakings(opened_from_kind, opened_from_id)
  WHERE opened_from_id IS NOT NULL;
