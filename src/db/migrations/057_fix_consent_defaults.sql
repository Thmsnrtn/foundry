-- =============================================================================
-- Migration 057: Fix wisdom_network opt-in default (DEFECT-0043)
--
-- Migration 004_signal_wisdom.sql sets wisdom_network_opted_in DEFAULT 1 (opted in).
-- Migration 018_wisdom_network.sql sets DEFAULT 0 (opted out).
-- In SQLite the first ALTER wins, so the column silently defaults to 1 — enrolling
-- founders without explicit consent (GDPR violation, tenancy-critical).
--
-- We cannot change the column default in SQLite without recreating the table, but
-- we CAN fix existing rows so no founder is enrolled without consent.
-- =============================================================================

-- Fix: Default should be 0 (opted out) per GDPR. First migration wins in SQLite.
-- This ALTER won't change the default but we can update existing rows:
UPDATE founders SET wisdom_network_opted_in = 0 WHERE wisdom_network_opted_in = 1;
