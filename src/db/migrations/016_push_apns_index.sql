-- =============================================================================
-- FOUNDRY — Migration 016: APNs Unique Index
-- Adds partial unique index on push_subscriptions(founder_id, apns_device_token)
-- so the iOS push registration upsert (ON CONFLICT) works correctly.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_apns
  ON push_subscriptions(founder_id, apns_device_token)
  WHERE apns_device_token IS NOT NULL;
