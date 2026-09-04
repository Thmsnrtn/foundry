-- =============================================================================
-- AN INDEX FOR A QUESTION ASKED ON EVERY RENDER
--
-- The first screen asks whether Foundry has ever looked at the market for this
-- owner. That is a yes or no, and it was answered with COUNT(*) over the whole
-- of market_retrievals with nothing indexed to scope it — a full scan of a
-- table that grows every morning, on the path of the page he opens most.
--
-- The count is now a single-row existence check, and this is the index that
-- makes it O(1) rather than O(everything ever retrieved).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_market_retrievals_founder
  ON market_retrievals(founder_id, retrieved_at DESC);
