-- =============================================================================
-- Migration 015: Rename subscription tiers
-- founding_cohort → solo, scale → investor_ready
-- =============================================================================

-- Update existing founders to new tier names
UPDATE founders SET tier = 'solo' WHERE tier = 'founding_cohort';
UPDATE founders SET tier = 'investor_ready' WHERE tier = 'scale';

-- Update the CHECK constraint requires recreating the table in SQLite.
-- The application enforces valid values via the SubscriptionTier type;
-- the CHECK constraint in schema.sql will apply to new installs.
-- For existing installs the UPDATE above is sufficient.
