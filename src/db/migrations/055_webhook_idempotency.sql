-- =============================================================================
-- Migration 055: Webhook Idempotency
-- Track processed Stripe webhook event IDs to prevent replay attacks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at DATETIME NOT NULL
);

-- Auto-cleanup: delete events older than 30 days (Stripe retries within 3 days)
-- Cleanup handled by a periodic job or manual query.
