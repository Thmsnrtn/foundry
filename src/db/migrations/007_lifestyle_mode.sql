-- =============================================================================
-- Migration 007: Lifestyle Mode
-- Allows founders to opt into steady-state mode, suppressing growth pressure.
-- =============================================================================

ALTER TABLE founders ADD COLUMN lifestyle_mode INTEGER DEFAULT 0;

ALTER TABLE founders ADD COLUMN lifestyle_target_mrr REAL;
