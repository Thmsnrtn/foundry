-- =============================================================================
-- FOUNDRY — Migration 004: Signal & Wisdom Network
-- Adds wisdom network opt-in to founders.
-- Adds push notification subscription storage.
-- =============================================================================

-- Wisdom network opt-in flag on founders.
-- Default TRUE: opted in by default, can be disabled in Settings.
ALTER TABLE founders ADD COLUMN wisdom_network_opted_in INTEGER NOT NULL DEFAULT 1;

-- Push notification subscriptions for Web Push API.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  signal_drop_threshold INTEGER NOT NULL DEFAULT 10,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (founder_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_founder ON push_subscriptions(founder_id);
