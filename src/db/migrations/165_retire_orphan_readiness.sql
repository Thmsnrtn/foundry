-- =============================================================================
-- Migration 165: retire the write-only fundraising readiness table
--
-- `fundraise_readiness` had a live writer — `POST /api/products/:id/
-- fundraise-readiness`, mounted and reachable — and NO READER. Not a page, not
-- an API response, not a prompt, not a report, not a job. No code in this
-- repository has ever run a SELECT against it.
--
-- Same shape as `peer_reviews`, and the owner has already decided this class:
-- do not build a reader to justify a writer. The API caller was never
-- deprived — the route returns the assessment in its response body, which is
-- what an API consumer actually uses. Only the row was pointless.
--
-- THE OTHER TWO READINESS TABLES STAY, AND THEY ARE NOT DUPLICATES OF EACH
-- OTHER. `fundraising_scores` scores readiness FOR A NAMED ROUND (pre_seed →
-- series_b, with round multipliers) and is read by the investor surface the
-- navigation points at and by the failure library. `funding_readiness` answers
-- a different question — are you ready to raise at all, with component scores
-- and a verdict — and is read by the surface that writes it. Collapsing them
-- because their names rhyme would destroy a distinction rather than remove a
-- duplication. Only the orphan goes.
-- =============================================================================

DROP INDEX IF EXISTS idx_fundraise;
DROP TABLE IF EXISTS fundraise_readiness;
