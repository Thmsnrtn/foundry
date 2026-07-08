-- =============================================================================
-- Migration 078: Activation funnel events (Phase 5.2)
--
-- Records the founder's progression through the activation funnel:
--   signup → repo_connected → audit_done → briefing_viewed →
--   decision_approved → trial_started → paid
--
-- One row per (founder, product, step) — the first occurrence wins (idempotent
-- via INSERT OR IGNORE), so each step is counted once per founder/product.
-- product_id is empty-string for pre-product steps (e.g. signup).
-- =============================================================================

CREATE TABLE IF NOT EXISTS funnel_events (
  id          TEXT PRIMARY KEY,
  founder_id  TEXT NOT NULL,
  product_id  TEXT NOT NULL DEFAULT '',
  step        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(founder_id, product_id, step)
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_step ON funnel_events(step, created_at);
