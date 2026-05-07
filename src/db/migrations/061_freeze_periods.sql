-- =============================================================================
-- FOUNDRY — V3.1 Layer A: Architecture Freeze Period
-- Ambros's recursion finding: enforce a discipline that blocks
-- architecture-class changes for a configurable window so the system can
-- collect operational data before the next round of internal critique.
-- =============================================================================

-- ─── Freeze Periods ──────────────────────────────────────────────────────────
-- One row per freeze instance per product. Active freeze = ended_at IS NULL.
-- Scope determines which categories of change are blocked:
--   'architecture_class' — schema changes, new crons, integrations,
--                          authority-expansion evolutions, new agent provisions
--   'all_evolution'      — every change_type except founder_correction
--   'process_only'       — only blocks new internal-process introductions
CREATE TABLE IF NOT EXISTS freeze_periods (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'architecture_class',
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  expected_end_at TEXT,                       -- e.g. started_at + 90 days
  ended_at TEXT,                              -- NULL = currently active
  ended_by TEXT,                              -- 'founder' | 'expired' | 'override'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_freeze_periods_product_active
  ON freeze_periods(product_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_freeze_periods_started
  ON freeze_periods(product_id, started_at DESC);

-- ─── Phase Beta Proposals ────────────────────────────────────────────────────
-- When a freeze blocks a decision, evolution, or addition, the original intent
-- is captured here for review at end of freeze. Nothing is lost; nothing
-- silently disappears.
CREATE TABLE IF NOT EXISTS phase_beta_proposals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,                  -- 'decision' | 'evolution' | 'cron_addition' | 'integration' | 'agent_provision'
  source_id TEXT,                             -- decision id, evolution version id, etc.
  proposed_change TEXT NOT NULL,              -- human-readable description
  proposed_by TEXT NOT NULL,                  -- agent name or 'founder' or 'system'
  rationale TEXT,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  blocked_during_freeze_id TEXT REFERENCES freeze_periods(id),
  status TEXT NOT NULL DEFAULT 'queued',      -- 'queued' | 'approved' | 'rejected' | 'force_applied' | 'superseded'
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_phase_beta_product_status
  ON phase_beta_proposals(product_id, status);
CREATE INDEX IF NOT EXISTS idx_phase_beta_freeze
  ON phase_beta_proposals(blocked_during_freeze_id);

-- ─── decisions: architecture-class flag ──────────────────────────────────────
-- 0 = routine operational decision (default)
-- 1 = architecture-class change (gated by freeze when freeze is active)
-- The flagger heuristic lives in the discipline service, not in SQL.
ALTER TABLE decisions ADD COLUMN architecture_class INTEGER DEFAULT 0;
ALTER TABLE decisions ADD COLUMN frozen_at TEXT;
