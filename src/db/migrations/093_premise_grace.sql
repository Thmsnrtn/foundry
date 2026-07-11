-- =============================================================================
-- Migration 093: Premise grace windows (Hands Law H3 / Ledger Law)
--
-- Some beliefs are bets about the FUTURE: "this campaign lifts signups to N"
-- is only judgeable after the campaign has had its window. effective_at defers
-- checking until the bet's own deadline — after that, the normal daily check
-- applies and a miss falsifies honestly. NULL = judgeable immediately
-- (existing behavior, unchanged for every existing premise).
-- =============================================================================

ALTER TABLE decision_premises ADD COLUMN effective_at DATETIME;
