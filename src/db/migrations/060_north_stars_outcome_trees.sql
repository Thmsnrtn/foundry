-- =============================================================================
-- FOUNDRY — V3.1 Layer A: North Star + Outcome Tree
-- Per-product 12-month destination + decomposed branches with mandatory
-- kill criteria (Sage's recursion finding from V3 architecture arc).
-- =============================================================================

-- ─── North Star ──────────────────────────────────────────────────────────────
-- One row per product. Founder-set 12-month target. Surfaced in briefings
-- as gap-to-target context for every agent run.
CREATE TABLE IF NOT EXISTS north_stars (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  arr_target_dollars REAL,                   -- e.g. 600000 = $600K ARR
  paying_accounts_target INTEGER,            -- e.g. 50 paying customers
  nrr_floor_pct REAL,                        -- e.g. 110 = 110% NRR floor
  target_date TEXT,                          -- 'YYYY-MM-DD' (12-month horizon)
  destination_summary TEXT,                  -- founder-written prose summary
  last_reviewed_at TEXT,                     -- founder review timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Outcome Tree ────────────────────────────────────────────────────────────
-- Each row is a single branch. Trees are formed by parent_branch_id chains.
-- Sage's rule: kill_criterion is required on every branch. Branches without
-- a clear kill criterion become wishlists; we forbid that at the schema level.
CREATE TABLE IF NOT EXISTS outcome_trees (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  parent_branch_id TEXT,                     -- NULL = root branch; else self-references id
  label TEXT NOT NULL,                       -- e.g. "Acquisition: 200 trial signups/mo"
  metric_key TEXT,                           -- joins with metric_snapshots when present
  current_value REAL,
  target_value REAL,
  unit TEXT,                                 -- 'count' | 'usd' | 'pct' | 'days' | other
  kill_criterion TEXT NOT NULL,              -- Sage: required, NOT NULL.
  status TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'killed' | 'achieved' | 'superseded'
  killed_at TEXT,
  killed_reason TEXT,
  achieved_at TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  weekly_refresh_run_id TEXT                 -- correlates branches generated in same weekly refresh
);

CREATE INDEX IF NOT EXISTS idx_outcome_trees_product
  ON outcome_trees(product_id, status);
CREATE INDEX IF NOT EXISTS idx_outcome_trees_parent
  ON outcome_trees(parent_branch_id);
CREATE INDEX IF NOT EXISTS idx_outcome_trees_run
  ON outcome_trees(product_id, weekly_refresh_run_id);
