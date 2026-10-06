-- =============================================================================
-- A CLAIM THAT CANNOT BE LOOKED AT IS ITS OWN FAILURE, NOT THE PASS'S
-- (Stage 1, F1.7).
--
-- `real_market_evidence_tick` looked at every other claim when one failed,
-- then failed the pass; the failed claim, never observed, was first in line
-- again the next morning. One claim the registry could not be asked about
-- marked the whole evidence loop failing every day (the G3 proof debt).
--
-- One row per failed look, so the claim waits a day, then two, and after the
-- third is set aside with an unknown on the claim saying so. Names a claim, no
-- person.
-- =============================================================================
CREATE TABLE IF NOT EXISTS market_claim_lookup_failures (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  because TEXT NOT NULL,
  failed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_claim_lookup_failures_claim ON market_claim_lookup_failures(claim_id, failed_at);
