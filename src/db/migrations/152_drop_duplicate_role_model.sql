-- =============================================================================
-- Migration 152: remove the second company authorization system
--
-- `account_roles` held a viewer/analyst/admin/owner ladder and
-- `role_permissions` an eleven-permission map. `assignRole` was the only thing
-- that could write an `account_roles` row, and it had no callers anywhere in
-- the system — so no row was ever created. `getUserRole` always returned null,
-- `requireRole('admin')` reduced to the owner check above it, and
-- `requirePermission` had no call sites at all.
--
-- The consequence was not a hole. It was the opposite, and it was worse than it
-- looked: seventeen routes that read as "an admin may do this" were owner-only
-- in practice, and an accepted co-founder could reach none of them. Meanwhile
-- `team_members` — what the invite flow actually writes — carried the real
-- permissions and nothing consulted them. Two authorization models, and the
-- guards were reading the one nobody wrote to.
--
-- Owner decision: company membership and its permissions are canonical in
-- `team_members`; ownership is a distinct, stronger property asked separately.
-- Nothing survives from these two tables to migrate — they hold no rows, in any
-- database, because nothing could ever put one there.
--
-- `role_permissions` was also never written: the permission map lived in
-- TypeScript. Both go.
-- =============================================================================

DROP TABLE IF EXISTS account_roles;
DROP TABLE IF EXISTS role_permissions;
