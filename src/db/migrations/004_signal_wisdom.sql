-- =============================================================================
-- FOUNDRY — Migration 004: Signal & Wisdom Network
-- Adds wisdom network opt-in to founders.
-- NOTE: push_subscriptions was originally created here but was superseded by
-- migration 013 which defines the full schema (APNs, preferences, platform, etc.).
-- The table creation has been moved entirely to 013 to avoid a schema conflict.
-- =============================================================================

-- Wisdom network opt-in flag on founders.
-- Default TRUE: opted in by default, can be disabled in Settings.
ALTER TABLE founders ADD COLUMN wisdom_network_opted_in INTEGER NOT NULL DEFAULT 1;
