-- =============================================================================
-- 369 — THE OWNER KEEPS THE DOOR ACROSS CLERK INSTANCES.
--
-- Moving sign-in from Clerk's development instance to a production instance
-- gives the owner a new Clerk user id. The owner's founder row is rebound to it
-- (services/founder/owner-identity.ts) — only for a verified primary email that
-- is the configured owner's — and each rebind is written here, so the record
-- says when the door changed hands and between which identities. Nothing edits
-- a rebind once written.
-- =============================================================================

CREATE TABLE IF NOT EXISTS owner_identity_rebinds (
  id                 TEXT PRIMARY KEY,
  founder_id         TEXT NOT NULL REFERENCES founders(id),
  from_clerk_user_id TEXT NOT NULL,
  to_clerk_user_id   TEXT NOT NULL,
  rebound_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_owner_identity_rebinds_founder
  ON owner_identity_rebinds(founder_id, rebound_at);

CREATE TRIGGER IF NOT EXISTS owner_identity_rebind_is_kept_as_it_was
BEFORE UPDATE ON owner_identity_rebinds
BEGIN
  SELECT RAISE(ABORT, 'owner_identity_rebind: kept as it was');
END;
