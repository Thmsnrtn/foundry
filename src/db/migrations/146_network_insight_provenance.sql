-- =============================================================================
-- Migration 146 — provenance on a cross-company claim
--
-- A network insight crosses a tenant boundary: it is derived from several
-- companies' decisions and then injected into a competitor's prompt. The row
-- recorded what it concluded — description, sample_size, confidence, impact —
-- and nothing about how it got there.
--
-- So none of these could be answered after the fact: which population was
-- considered, how many distinct companies actually backed the claim as against
-- being merely present in the cohort, which option and direction it is about,
-- over what window the observations were drawn, what was excluded, and which
-- version of the aggregation method produced it.
--
-- That matters more here than almost anywhere else in the codebase, because
-- this is the one claim a founder reads about OTHER companies. "12 contributing
-- companies" was already wrong once — it was the cohort size, not the
-- contributors — and it was wrong invisibly, because the row could not be
-- checked against anything.
--
-- ONE COLUMN, not a schema. The facts are heterogeneous and only ever read
-- together, as a record of how this row came to exist.
--
-- `observed_through` is separate because it is queried: an insight drawn from
-- decisions made two years ago should not be presented as current, and a
-- freshness filter needs a column it can compare.
-- =============================================================================

ALTER TABLE cross_product_insights ADD COLUMN provenance_json TEXT;
ALTER TABLE cross_product_insights ADD COLUMN observed_through TEXT;

CREATE INDEX IF NOT EXISTS idx_cross_product_insights_freshness
  ON cross_product_insights(sector, growth_stage, observed_through);
