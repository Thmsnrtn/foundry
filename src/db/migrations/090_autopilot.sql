-- =============================================================================
-- Migration 090: The Autopilot (Ascent B6 realized / Trust Law)
--
-- Foundry graduates from advisor to autopilot, converged on AcreOS's mature
-- governed-autonomy semantics. Per decision category, a policy holds the mode:
--   shadow  — (default) measure only: would the agents' recommendation have
--             matched the founder's choice? Trust accrues at zero risk.
--   suggest — recommendation surfaced as the default; founder still decides.
--   act     — the Second Self resolves LOW-STAKES (gate ≤ 1) decisions to the
--             recommendation after a grace window, notified, 24h-undoable.
--
-- Promotion is EARNED, not configured: clean cycles (real positive outcomes of
-- autopilot/founder-agreed decisions) accrue per category; shadow→suggest
-- auto-promotes at the threshold (with a decision-quality hold); the step INTO
-- 'act' always requires explicit founder consent (constitutional Trust Law).
-- Demotion is an instant circuit-breaker: one rung down, count reset, reason
-- stamped. An undo of an autopilot action demotes — the founder's correction
-- is the strongest trust signal there is.
-- =============================================================================

CREATE TABLE IF NOT EXISTS autopilot_policies (
  id                    TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL,
  category              TEXT NOT NULL,
  mode                  TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'suggest', 'act')),
  set_by                TEXT NOT NULL DEFAULT 'default',   -- founder id | 'earned' | 'undo_demotion' | 'anomaly' | 'panic'
  clean_cycles          INTEGER NOT NULL DEFAULT 0,
  last_promoted_at      DATETIME,
  last_demoted_at       DATETIME,
  last_demotion_reason  TEXT,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, category)
);

CREATE INDEX IF NOT EXISTS idx_autopilot_product ON autopilot_policies(product_id);

-- Marks a decision's outcome as already counted into the autopilot ledger, so
-- feedback is exactly-once.
ALTER TABLE decisions ADD COLUMN autopilot_counted INTEGER NOT NULL DEFAULT 0;
