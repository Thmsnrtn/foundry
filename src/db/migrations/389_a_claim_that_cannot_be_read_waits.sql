-- =============================================================================
-- A CLAIM THAT CANNOT BE LOOKED AT WAITS, AND IS NAMED (remediation 1.6).
--
-- `real_market_evidence_tick` looks at every unread claim, and since Roadmap G3
-- throws at the end of a pass in which any claim failed, so `job_health` says
-- the loop failed rather than calling the day calm. That stays. What was
-- missing: one claim nothing could read failed the whole routine on every
-- morning, forever, with no backoff, and the failure lived only in a log line.
--
-- One row per failed look, as `forge_refusals` (386) does for the forge: the
-- same claim waits 2^(n-1) days after its n-th failure, and after the fourth it
-- is not looked at again. A pass in which no claim failed passes. No person is
-- named; a claim id and the source's own reason.
-- =============================================================================
CREATE TABLE IF NOT EXISTS claim_look_failures (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  because TEXT NOT NULL,
  failed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_look_failures_claim ON claim_look_failures(claim_id, failed_at);
