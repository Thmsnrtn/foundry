-- =============================================================================
-- Migration 144 — contributor hash on decision patterns
--
-- `decision_patterns` is deliberately anonymous: it carries no product_id, so a
-- row cannot be traced back to the company that made the decision. That was the
-- right instinct and it had a cost nobody priced. Without ANY contributor
-- identity, the aggregation could not tell three decisions by three companies
-- from three decisions by one — so its "min sample size = 10" guarantee was
-- enforced on the cohort (how many opted-in companies exist in this sector)
-- rather than on the contributors (how many of them are actually in this
-- insight). An insight derived from one company could be, and would be, shown
-- to that company's competitors.
--
-- A hash restores the property that was lost without giving back the one that
-- was wanted: the aggregation can require k DISTINCT contributors while still
-- being unable to say who any of them are. It is an HMAC keyed with the
-- application's encryption key, so it is not reversible by guessing product
-- ids out of a leaked table.
--
-- Existing rows stay NULL. `COUNT(DISTINCT contributor_hash)` ignores NULLs, so
-- legacy patterns count toward nobody — they cannot satisfy the threshold, and
-- an insight that needs them will simply not be published. That is the
-- fail-closed direction: the alternative is to keep publishing insights whose
-- provenance is unknown.
-- =============================================================================

ALTER TABLE decision_patterns ADD COLUMN contributor_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_decision_patterns_contributor
  ON decision_patterns(market_category, product_lifecycle_stage, contributor_hash);
