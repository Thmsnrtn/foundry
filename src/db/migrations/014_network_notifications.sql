-- =============================================================================
-- Migration 014: Network Benchmarks + Notification Preferences
-- =============================================================================

-- ─── Network Benchmarks ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS network_benchmarks (
  id TEXT PRIMARY KEY,
  metric_key TEXT NOT NULL,           -- e.g. 'activation_rate', 'churn_rate'
  market_category TEXT NOT NULL,      -- e.g. 'developer_tools'
  lifecycle_stage TEXT NOT NULL,      -- e.g. 'seed', 'series_a'
  p25 REAL NOT NULL,
  p50 REAL NOT NULL,
  p75 REAL NOT NULL,
  p90 REAL NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(metric_key, market_category, lifecycle_stage)
);

CREATE TABLE IF NOT EXISTS network_contributions (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  contributed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metrics_contributed INTEGER DEFAULT 0,
  UNIQUE(product_id, date(contributed_at))
);

-- ─── Network opt-in on founders ───────────────────────────────────────────────

ALTER TABLE founders ADD COLUMN network_opt_in INTEGER NOT NULL DEFAULT 0;

-- ─── Notification Preferences ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  signal_red INTEGER NOT NULL DEFAULT 1,
  signal_yellow INTEGER NOT NULL DEFAULT 0,
  new_decision INTEGER NOT NULL DEFAULT 1,
  new_stressor INTEGER NOT NULL DEFAULT 1,
  morning_briefing INTEGER NOT NULL DEFAULT 1,
  alignment_drop INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id, product_id)
);

-- ─── Add last_active_at to push_subscriptions if missing ─────────────────────

ALTER TABLE push_subscriptions ADD COLUMN last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- ─── Add UNIQUE constraint support for push token upsert ─────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_founder_token
  ON push_subscriptions(founder_id, apns_device_token)
  WHERE apns_device_token IS NOT NULL;
