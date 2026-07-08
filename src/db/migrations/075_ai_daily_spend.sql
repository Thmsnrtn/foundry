-- =============================================================================
-- Migration 075: Persist AI daily spend (Phase 0.2)
--
-- The daily AI cost ceiling lived in an in-process Map that reset on every
-- deploy and was not shared across machines, so the $25/day guard was
-- effectively unenforced. Spend is now persisted here (source of truth), with
-- the Map kept only as a short-TTL read-through cache.
--
-- scope: 'product' | 'founder' | 'global'
-- scope_id: product_id | founder_id | '__global__'
-- date: UTC day (YYYY-MM-DD)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_daily_spend (
  scope       TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  date        TEXT NOT NULL,
  spent_cents REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (scope, scope_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ai_daily_spend_date ON ai_daily_spend(date);
