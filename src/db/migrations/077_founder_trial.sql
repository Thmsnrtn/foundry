-- =============================================================================
-- Migration 077: Founder trial window (Phase 1.3)
--
-- Foundry had no conversion mechanism: founder.tier defaulted NULL and the full
-- product worked unpaid. We now run a 14-day card-upfront trial. trial_ends_at
-- is populated from the Stripe subscription's trial_end on
-- customer.subscription.created/updated; NULL means "not on a trial".
-- =============================================================================

ALTER TABLE founders ADD COLUMN trial_ends_at TEXT;
