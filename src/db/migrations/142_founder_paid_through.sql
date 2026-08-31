-- =============================================================================
-- Migration 142 — paid-through date on founders
--
-- Entitlement was decided by two facts: `tier` (are they on a plan) and
-- `trial_ends_at` (is a trial live). Neither can express the ordinary SaaS
-- shape the owner asked for: a founder cancels, and keeps the service they have
-- already paid for until the end of the current billing period.
--
-- With only those two columns the choice was between cutting access off the
-- moment somebody cancels — which is what the code did, by nulling `tier` and
-- pausing every product inside the `customer.subscription.deleted` handler —
-- and leaving them entitled forever. Both are wrong, and the first is the one
-- customers notice.
--
-- `paid_through` is the period end Stripe already sends on every subscription
-- event (`current_period_end`). Recording it makes cancellation a fact about
-- the future rather than an immediate revocation, and it makes the dunning
-- grace period fall out of the same rule: while an invoice is being retried,
-- Stripe has already advanced the period end, so the account stays live.
--
-- NULL means "no paid period known", which is the state of every founder who
-- has never subscribed. It is not an entitlement, and every read COALESCEs it.
-- =============================================================================

ALTER TABLE founders ADD COLUMN paid_through TEXT;

CREATE INDEX IF NOT EXISTS idx_founders_paid_through ON founders(paid_through);
