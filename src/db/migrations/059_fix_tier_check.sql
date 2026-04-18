-- =============================================================================
-- Migration 059: Fix tier CHECK constraint
-- DEFECT-0057: schema.sql has (solo, growth, investor_ready) but migration 001
-- has (founding_cohort, growth, scale). SQLite doesn't enforce CHECK on existing
-- rows, but new inserts would fail. Update any legacy tier values.
-- =============================================================================

-- Fix any rows still using old tier names
UPDATE founders SET tier = 'solo' WHERE tier = 'founding_cohort';
UPDATE founders SET tier = 'investor_ready' WHERE tier = 'scale';
