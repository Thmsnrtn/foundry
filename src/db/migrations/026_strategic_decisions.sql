-- Migration 026: Decision log with retrospective scoring
-- Tracks significant company decisions and supports 90-day retrospective evaluation.

-- strategic_decisions_log: captures each decision at the time it was made,
-- with optional retrospective scoring added ~90 days later.
-- agent_context_json stores which agents surfaced signals related to this decision.
CREATE TABLE IF NOT EXISTS strategic_decisions_log (
  id                      TEXT PRIMARY KEY,
  product_id              TEXT NOT NULL,
  decision_title          TEXT NOT NULL,
  decision_description    TEXT NOT NULL,
  decision_rationale      TEXT,
  expected_outcome        TEXT,
  decision_category       TEXT CHECK (decision_category IN (
                            'pricing','product','hiring','marketing','fundraising',
                            'operations','technology','customer','partnership','other'
                          )),
  made_by                 TEXT CHECK (made_by IN ('founder','agent_recommendation','team')),
  confidence_at_decision  INTEGER CHECK (confidence_at_decision BETWEEN 1 AND 5),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','reversed','succeeded','failed','inconclusive')),

  -- Retrospective fields — populated ~90 days after the decision
  retrospective_score     INTEGER CHECK (retrospective_score BETWEEN 1 AND 5),  -- nullable
  retrospective_notes     TEXT,
  retrospective_due_at    TEXT,         -- typically made_at + 90 days
  actual_outcome          TEXT,

  -- JSON object keyed by agent name containing the signal or flag that was raised
  agent_context_json      TEXT NOT NULL DEFAULT '{}',

  made_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategic_decisions_product    ON strategic_decisions_log(product_id);
CREATE INDEX IF NOT EXISTS idx_strategic_decisions_made_at    ON strategic_decisions_log(made_at);
CREATE INDEX IF NOT EXISTS idx_strategic_decisions_status     ON strategic_decisions_log(status);
