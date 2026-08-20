-- =============================================================================
-- Migration 176: product telemetry is not service state
--
-- OWNER DECISION (§14, answered): split analytics.
--
--   Necessary service, billing, security and configuration state stays
--   UNGATED and disclosed. Foundry cannot run or bill an account without
--   knowing it signed up, connected its repo, started a trial and paid, and a
--   consent toggle over that would be offering a choice that is not real.
--
--   Optional feature, navigation and product-improvement telemetry must
--   ACTUALLY HONOUR the "Help Improve Foundry" preference — which read
--   nothing at all, so a founder who switched it off was told their usage
--   patterns were not being used while their NAMED progression was recorded
--   anyway.
--
--   And the two are SEPARATED rather than treated as one funnel, because a
--   single table with a consent rule applied to some of its rows is a rule
--   somebody eventually forgets.
--
-- MINIMISATION FIRST, DE-IDENTIFICATION SECOND. Without consent nothing is
-- recorded here at all — that is what makes the toggle real, rather than a
-- filter applied at read time over data already kept. With consent, the row
-- carries a CONTRIBUTOR HASH and no founder id, no product id and no free
-- text: enough to count distinct people through a funnel, and not enough to
-- say who they are.
--
-- WHAT THE HASH DOES AND DOES NOT DO, stated because the same construct is
-- used by the wisdom network and the same caveat applies: it is
-- PSEUDONYMISATION. It means this table alone names nobody and that an erasure
-- removes the linkage. It does not mean an internal reader holding the founder
-- list could not recompute it. Claiming more than that would be the exact
-- overstatement the privacy page was corrected for.
--
-- ERASURE REACHES IT, by the same route `decision_patterns` is reached: keyed
-- on `contributor_hash`, listed in the erasure's named-key map, so an erased
-- account's telemetry goes with them rather than surviving as an orphan
-- nobody can find.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_telemetry_events (
  id TEXT PRIMARY KEY,
  -- Stable per person, and the only identifier here. Never a founder id.
  contributor_hash TEXT NOT NULL,
  step TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- One row per person per step: this counts whether somebody reached a step,
-- not how many times, which is the smallest thing that answers the question.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_telemetry_identity
  ON product_telemetry_events(contributor_hash, step);
CREATE INDEX IF NOT EXISTS idx_product_telemetry_step
  ON product_telemetry_events(step, created_at);
