-- =============================================================================
-- Migration 174: a pattern says whether anybody observed it
--
-- `cohort_patterns.company_count` is documented as "how many companies informed
-- this", and the network-intelligence page renders it as
-- "Observed across 38 similar companies."
--
-- Nothing observed them. The only writer of this table is
-- `seedDefaultCohortPatterns`, which inserts five hand-written rows with the
-- counts 38, 52, 44, 29 and 18 typed into the source, and it runs on the first
-- page load. A founder on a paid tier reads a population claim about companies
-- that were never counted, because none were.
--
-- The patterns themselves are worth keeping. They are reasonable industry
-- priors and saying so is presentation, which is allowed. Asserting them as
-- observation is fabricated evidence, which is not — and the difference is one
-- column.
--
--   'observed'  — derived from companies in Foundry's own network. The count
--                 means what the column says it means.
--   'reference' — a prior somebody wrote down. The count is illustrative and
--                 the surface must not say "observed".
--
-- Default 'observed' is deliberate: a future writer that derives a pattern from
-- real cohorts gets the truthful value without doing anything, and the rows
-- that are NOT observations are the ones that have to say so. The seed is
-- updated in the same change.
-- =============================================================================

ALTER TABLE cohort_patterns ADD COLUMN evidence_source TEXT NOT NULL DEFAULT 'observed'
  CHECK (evidence_source IN ('observed', 'reference'));

UPDATE cohort_patterns SET evidence_source = 'reference' WHERE id LIKE 'cp_%_seed_%';
