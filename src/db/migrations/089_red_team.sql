-- =============================================================================
-- Migration 089: Red Team (Ascent B2 / Dissent Law)
--
-- An adversarial pre-mortem council for high-stakes (gate 3+) decisions. Its
-- objections are ANTI-PREMISES — falsifiable predictions of failure. When the
-- founder overrules an objection, its inverse is recorded as a monitored
-- premise (Memory Kernel), so being wrong is always discoverable, and a later
-- falsification VINDICATES the dissent — a calibration point (Trust/Honesty
-- Laws) that raises the Red Team's voice in that category.
-- =============================================================================

CREATE TABLE IF NOT EXISTS red_team_reviews (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL,
  decision_id         TEXT NOT NULL,             -- decisions.id (founder queue)
  verdict             TEXT NOT NULL CHECK (verdict IN
                        ('proceed', 'proceed_with_changes', 'do_not_proceed')),
  strongest_objection TEXT,
  objections_json     TEXT NOT NULL DEFAULT '[]', -- [{lens, claim, severity, metric_key?, comparator?, threshold?, mitigation}]
  confidence          REAL,                       -- council's own 0..1 confidence in its verdict
  -- Calibration outcome, resolved later by the Memory Kernel:
  --   vindicated  — an overruled objection's premise was falsified (dissent was right)
  --   overruled_held — founder overruled and the premises held (dissent was wrong)
  resolved_outcome    TEXT CHECK (resolved_outcome IN ('vindicated', 'overruled_held')),
  resolved_at         DATETIME,
  tokens_used         INTEGER DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_red_team_decision ON red_team_reviews(decision_id);
CREATE INDEX IF NOT EXISTS idx_red_team_product ON red_team_reviews(product_id, created_at);

-- Who asserted a premise: the founder's own stated belief, or the inverse of an
-- overruled Red Team objection. Lets falsification credit the right ledger.
ALTER TABLE decision_premises ADD COLUMN origin TEXT NOT NULL DEFAULT 'founder';
ALTER TABLE decision_premises ADD COLUMN review_id TEXT;  -- red_team_reviews.id when origin='red_team'
