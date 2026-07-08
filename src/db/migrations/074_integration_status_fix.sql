-- =============================================================================
-- Migration 074: Standardize integration status on 'connected' (Phase 0.1)
--
-- The integration fabric wrote status = 'active' when connecting an integration
-- (fabric.ts connectIntegration + the OAuth callback in routes/dashboard/
-- integrations.ts), but all six sync adapters (posthog, sentry, linear, slack,
-- intercom, github) guard on status === 'connected'. Nothing ever wrote
-- 'connected', so the hourly scpIntegrationFabricSync and 2-hourly extended sync
-- were silent no-ops: integration_events stayed empty and every agent reasoned
-- over zero telemetry.
--
-- The code now writes 'connected' everywhere. This migration repairs existing
-- rows so already-connected integrations start syncing immediately.
-- =============================================================================

UPDATE integrations SET status = 'connected' WHERE status = 'active';
