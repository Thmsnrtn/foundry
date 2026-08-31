-- =============================================================================
-- Migration 151: the capability the role label was standing in for
--
-- `team_members` has carried five permission columns since migration 010, and
-- batch 51 gave the two that had reachable surfaces a real enforcement edge.
-- The other authorization system — `account_roles` — was never written to by
-- anything, so `requireRole('admin')` reduced to the owner check above it and
-- the seventeen routes it guards were owner-only in practice.
--
-- Those routes are not owner-only work. They are ordinary company management:
-- issue an API key, connect a sending address, rotate an ingest credential,
-- toggle the wisdom network, invite a colleague. A co-founder should be able
-- to do them; an advisor or an investor observer should not. That is a
-- capability, and the five existing columns do not express it — so it gets its
-- own, rather than being smuggled through `can_trigger_actions`, which means
-- something else.
--
-- WHAT IT IS NOT. It is not ownership. Cancelling the subscription, pausing the
-- company, archiving the product and changing who pays remain the owner's
-- alone, and stay behind an ownership check rather than any permission.
--
-- Backfilled from the role label, which is where this intent has been recorded
-- all along: `can_trigger_actions` already defaults TRUE only for co_founder.
-- The label stays a label — it does not grant anything by itself — but it is
-- the best available evidence of what each existing member was invited to do.
-- =============================================================================

ALTER TABLE team_members ADD COLUMN can_manage_company BOOLEAN DEFAULT FALSE;

UPDATE team_members SET can_manage_company = 1 WHERE role = 'co_founder';
