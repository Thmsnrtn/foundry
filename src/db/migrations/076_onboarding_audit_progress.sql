-- =============================================================================
-- Migration 076: Onboarding audit progress (Phase 1.1 / 1.2)
--
-- The onboarding audit was a blocking 2-5 minute POST with no feedback. It now
-- runs asynchronously; the founder watches a progress page that HTMX-polls this
-- row. One row per product (the latest run overwrites).
--
-- status: 'running' | 'completed' | 'error'
-- =============================================================================

CREATE TABLE IF NOT EXISTS onboarding_audit_progress (
  product_id    TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'running',
  current_step  INTEGER NOT NULL DEFAULT 0,
  total_steps   INTEGER NOT NULL DEFAULT 9,
  step_label    TEXT NOT NULL DEFAULT 'Starting…',
  error         TEXT,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
