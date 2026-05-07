-- =============================================================================
-- FOUNDRY — V3.1 Layer A: Team Health Metrics
-- Ambros's six metrics, computed weekly per product. Read-only over existing
-- tables (decisions, agent_messages, agent_evolution_versions,
-- agent_predictions). Cached as a row per (product, week) for trend display
-- and recursive-critique-yield monitoring.
-- =============================================================================

CREATE TABLE IF NOT EXISTS team_health_metrics (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week_starting TEXT NOT NULL,                  -- 'YYYY-MM-DD' Monday
  -- ─── Critique discipline ──────────────────────────────────────────────────
  critique_pass_rate_pct REAL,                  -- 0-100
  total_critiques INTEGER NOT NULL DEFAULT 0,
  critiques_resulting_in_change INTEGER NOT NULL DEFAULT 0,
  -- ─── Founder override rate ───────────────────────────────────────────────
  override_rate_pct REAL,                       -- 0-100
  total_decisions_resolved INTEGER NOT NULL DEFAULT 0,
  decisions_overridden INTEGER NOT NULL DEFAULT 0,
  -- ─── Recursive critique yield (Ambros Round 5) ────────────────────────────
  -- The signal that says "stop iterating" when yield drops below threshold.
  evolutions_promoted_count INTEGER NOT NULL DEFAULT 0,
  recursive_yield_score REAL,                   -- 0-1
  -- ─── Decision velocity ────────────────────────────────────────────────────
  decisions_queued INTEGER NOT NULL DEFAULT 0,
  decisions_resolved INTEGER NOT NULL DEFAULT 0,
  median_time_to_action_hours REAL,
  -- ─── Action accuracy ──────────────────────────────────────────────────────
  action_accuracy_pct REAL,                     -- 0-100 from agent_predictions
  -- ─── Meta ─────────────────────────────────────────────────────────────────
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, week_starting)
);

CREATE INDEX IF NOT EXISTS idx_team_health_product_week
  ON team_health_metrics(product_id, week_starting DESC);
