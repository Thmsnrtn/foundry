-- =============================================================================
-- Migration 080: Fix founders.tier CHECK constraint (walkthrough finding)
--
-- founders.tier was created (001_initial) with CHECK(tier IN
-- ('founding_cohort','growth','scale')), but the entire codebase uses
-- ('solo','growth','investor_ready') — the Stripe webhook, tier gates, billing,
-- and the SubscriptionTier type. Migration 059 updated legacy *values* but
-- (its own comment admits) "new inserts would fail" — SQLite can't ALTER a
-- CHECK, so the stale constraint persisted. Result: on any real database,
-- `UPDATE founders SET tier='solo'` after checkout FAILS the CHECK, so a paying
-- customer's tier is never recorded and they stay gated as if unpaid.
--
-- Fix: rebuild founders with the tier CHECK removed (tier is validated in the
-- app via the SubscriptionTier type). All 21 columns and the UNIQUE keys the
-- auth ON CONFLICT relies on are preserved.
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS founders_new (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,
  tier TEXT,                                  -- CHECK removed (app-validated)
  cohort_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  preferences TEXT,
  onboarding_completed_at DATETIME,
  last_seen_at DATETIME,
  wisdom_network_opted_in INTEGER NOT NULL DEFAULT 1,
  lifestyle_mode INTEGER DEFAULT 0,
  lifestyle_target_mrr REAL,
  country_code TEXT DEFAULT 'US',
  local_currency TEXT DEFAULT 'USD',
  ppp_factor REAL DEFAULT 1.0,
  network_opt_in INTEGER NOT NULL DEFAULT 0,
  wisdom_network_consent_date TEXT,
  referred_by_code TEXT,
  trial_ends_at TEXT
);

INSERT INTO founders_new (
  id, clerk_user_id, email, name, stripe_customer_id, tier, cohort_id, created_at,
  preferences, onboarding_completed_at, last_seen_at, wisdom_network_opted_in,
  lifestyle_mode, lifestyle_target_mrr, country_code, local_currency, ppp_factor,
  network_opt_in, wisdom_network_consent_date, referred_by_code, trial_ends_at
)
  SELECT
    id, clerk_user_id, email, name, stripe_customer_id, tier, cohort_id, created_at,
    preferences, onboarding_completed_at, last_seen_at, wisdom_network_opted_in,
    lifestyle_mode, lifestyle_target_mrr, country_code, local_currency, ppp_factor,
    network_opt_in, wisdom_network_consent_date, referred_by_code, trial_ends_at
  FROM founders;

DROP TABLE founders;
ALTER TABLE founders_new RENAME TO founders;

CREATE INDEX IF NOT EXISTS idx_founders_tier ON founders(tier);

PRAGMA foreign_keys=ON;
