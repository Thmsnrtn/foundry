-- =============================================================================
-- 366 — THE COPY LEAVES THE MACHINE.
--
-- Every daily copy lived on the database's own volume (keeping.ts). The
-- executive review of 29 September 2026 named that the institution's single
-- point of failure. Each copy that passes its restore rehearsal is now sealed
-- and sent to object storage off the machine (sending-away.ts); this is the
-- record of what was sent, so the health reading can say how old the newest
-- copy away is.
--
-- It is this machine's own record, and it is lost with the volume — which is
-- exactly why a restore reads the bucket's own listing, never this table.
-- Institutional bookkeeping about a file, naming nobody.
-- =============================================================================

CREATE TABLE copies_sent_away (
  away_key TEXT PRIMARY KEY CHECK (away_key GLOB 'foundry-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].db.gz.sealed'),
  bytes    INTEGER NOT NULL CHECK (bytes > 0),
  sha256   TEXT NOT NULL CHECK (length(sha256) = 64),
  sent_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
