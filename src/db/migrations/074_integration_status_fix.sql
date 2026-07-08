-- =============================================================================
-- Migration 074: Standardize integration status on 'active' (Phase 0.1 / 2.4)
--
-- The sync adapters (posthog/sentry/linear/slack/intercom/github) guard on a
-- healthy integration status. The original bug was that they checked
-- 'connected' — a value that nothing wrote AND that no `integrations` schema's
-- status CHECK constraint even permits (008: pending/active/error/paused/
-- revoked; 021_integration_fabric: active/paused/errored/pending_auth/
-- disconnected). So the hourly fabric sync silently no-op'd and agents reasoned
-- over zero telemetry.
--
-- The code now standardizes on 'active' everywhere (connectIntegration writes
-- it, every adapter guards on it, and every schema's CHECK allows it). This
-- migration repairs any rows that a transient earlier build may have written as
-- 'connected' back to the canonical 'active'. It's a no-op on databases that
-- never wrote 'connected'.
-- =============================================================================

UPDATE integrations SET status = 'active' WHERE status = 'connected';
