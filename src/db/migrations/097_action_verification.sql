-- =============================================================================
-- Migration 097: Action verification (Jarvis evolution axis 1)
--
-- The verifier graduates from guarding what the system SAYS to guarding what
-- it DOES. An act-tier execution declares success criteria BEFORE acting;
-- an independent sweep re-checks them AFTER their window from fresh ledger
-- reads. Pass → verified on the record. Fail → audit defect + a trust-ladder
-- anomaly (instant one-rung demotion for the acting category). This is what
-- makes higher autonomy tiers safe to grant.
-- =============================================================================

ALTER TABLE action_executions ADD COLUMN verify_criteria TEXT;   -- JSON array
ALTER TABLE action_executions ADD COLUMN verify_status TEXT;     -- pending|passed|failed
ALTER TABLE action_executions ADD COLUMN verify_after DATETIME;  -- when to check
ALTER TABLE action_executions ADD COLUMN verified_at DATETIME;
