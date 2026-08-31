-- =============================================================================
-- Migration 180: a funding readiness verdict says what it knew
--
-- `funding_readiness` stored a score, a verdict and a gap list. It did not
-- store how much of the score had a real input behind it, and it could not:
-- each component scores 50 when its input is null, so a company that had
-- reported nothing scored roughly the same as one measured and found average.
--
-- Worse, the gap list tested those 50s against thresholds of 60, so an
-- unmeasured company was told "Churn rate above acceptable threshold for this
-- stage" and "Activation rate below benchmarks for fundraising" — specific
-- findings about numbers that did not exist, in a document it would fundraise
-- on.
--
-- Two columns, so the distinction reaches the page rather than living in a
-- return value nobody stores: what is NOT KNOWN, kept apart from what is known
-- and wanting, and how many of the seven components were real.
-- =============================================================================

ALTER TABLE funding_readiness ADD COLUMN unmeasured TEXT;
ALTER TABLE funding_readiness ADD COLUMN measured_components INTEGER;
