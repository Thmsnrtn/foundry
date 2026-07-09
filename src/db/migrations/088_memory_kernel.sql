-- =============================================================================
-- Migration 088: Memory Kernel (Ascent B1) — the belief ledger.
--
-- Foundry already logs WHAT happened (temporal_events) and stores a decision's
-- rationale + key_assumptions_json (strategic_decisions_log). The Memory Kernel
-- adds the missing layer: WHY a decision was made, captured as testable
-- *premises*, monitored against live telemetry, so a decision whose premise has
-- since been falsified can be surfaced ("you bet X because you believed Y; Y is
-- now false — revisit"). This is the anti-drift engine: decisions don't quietly
-- expire unnoticed.
--
-- A premise is either:
--   • metric      — a checkable belief (metric_key comparator threshold), e.g.
--                   "churn_rate < 0.05"; the premise-check job evaluates it
--                   against the latest metric_snapshot and flips it to
--                   'falsified' when violated.
--   • qualitative — a free-text belief the founder/agents revisit manually.
-- =============================================================================

CREATE TABLE IF NOT EXISTS decision_premises (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL,
  -- The decision this premise underpins. decision_source disambiguates which
  -- table decision_id points at (the founder-facing queue vs the strategic log).
  decision_id     TEXT NOT NULL,
  decision_source TEXT NOT NULL DEFAULT 'strategic'
                    CHECK (decision_source IN ('strategic', 'decision')),
  premise         TEXT NOT NULL,               -- the belief, in the founder's words
  premise_type    TEXT NOT NULL DEFAULT 'qualitative'
                    CHECK (premise_type IN ('metric', 'qualitative')),
  metric_key      TEXT,                         -- for metric premises (e.g. 'churn_rate')
  comparator      TEXT CHECK (comparator IN ('<', '<=', '>', '>=', '==')),
  threshold       REAL,
  status          TEXT NOT NULL DEFAULT 'holding'
                    CHECK (status IN ('holding', 'falsified', 'unverifiable', 'revisited')),
  last_checked_at DATETIME,
  falsified_at    DATETIME,
  evidence        TEXT,                         -- what falsified it (the observed value)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_premises_product_status ON decision_premises(product_id, status);
CREATE INDEX IF NOT EXISTS idx_premises_decision ON decision_premises(decision_id);
