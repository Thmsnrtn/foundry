-- =============================================================================
-- FOUNDRY — two tables whose only readers were deleted pages
--
-- `funding_readiness` and `okr_progress_updates` belonged to Commercial
-- Foundry: an investor-readiness verdict and the progress notes under an OKR.
-- The seventy-two route modules that read and wrote them were deleted on
-- 13 September 2026, and nothing in TypeScript names either table now.
--
-- THE RATCHET THAT FOUND THEM IS PINNED AT ZERO, and that is the point. An
-- earlier pass dropped eleven tables nothing ever wrote and left
-- `unreferenced-tables-baseline.txt` empty with a test asserting it can only
-- stay that way. Adding these two to the baseline instead of dropping them
-- would have been the first crack in a gate whose whole value is that it has
-- no exceptions. The deletion of a surface is exactly when that pressure
-- arrives, so this is where the rule is either kept or quietly abandoned.
--
-- BOTH ARE EMPTY IN PRODUCTION — checked against the live volume before this
-- was written, not assumed from the fact that nothing reads them. Zero rows in
-- each; no data is lost.
--
-- `okr_progress_updates` also appears in the erasure walk's own comment as the
-- worked example of erasure-by-descent — reaching a product through
-- `key_results` and `company_okrs`. The mechanism it illustrates is unchanged;
-- only the example is gone, and the comment is corrected in the same commit so
-- that nothing explains itself with a table that does not exist.
-- =============================================================================

DROP TABLE IF EXISTS okr_progress_updates;
DROP TABLE IF EXISTS funding_readiness;
