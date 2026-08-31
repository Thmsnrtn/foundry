-- =============================================================================
-- Migration 175: an erased person leaves no name in a company they did not own
--
-- OWNER DECISION (§10, answered): split by kind, with AUTHORITY versus ARTEFACT
-- as the governing distinction.
--
--   Authority — `api_keys`, `mcp_grants` — is REVOKED. Personal authority is
--   never transferred to somebody else: an authority held by a principal that
--   no longer exists must not act, and handing it to the company owner would
--   be inventing a grant nobody made. Those two need no schema change; the
--   erasure revokes and removes them, and writes a company-visible record so
--   the breakage is not silent.
--
--   Artefact — `webhooks`, `deal_rooms`, `decision_votes` — is PRESERVED and
--   its author SEVERED. The company authored the work and keeps it; the erased
--   person's identity goes. "Do not falsely reassign authorship": the column
--   becomes NULL, which says NOBODY, rather than another founder's id, which
--   would say somebody who did not do it.
--
-- WHY A MIGRATION AT ALL. All three identity columns are NOT NULL, so severing
-- was not available without one. That is the entire reason these five tables
-- sat marked `owner_decision` and untouched by the erasure while every other
-- table was settled: not indecision, an absent column state.
--
-- WHAT NULL MEANS HERE, stated so a later reader does not guess. On these three
-- columns it means "the person who did this has been erased." It does not mean
-- "unknown", and nothing may write NULL on creation — the application still
-- supplies an author, and the erasure is the only path that clears one.
--
-- `decision_votes` KEEPS ITS FREE TEXT. `rationale` and `concerns` are the
-- reasoning behind a company decision, and a decision record stripped of why is
-- not a truthful record. They are also the erased person's own words. That
-- tension is irreducible in engineering and is queued for counsel
-- (OWNER_DECISIONS_PENDING §9). The attribution goes now; the words wait for an
-- answer rather than being deleted on a guess or kept without one.
--
-- UNIQUE(decision_id, founder_id) SURVIVES AND STILL WORKS. SQLite treats NULLs
-- as distinct in a unique index, so two erased people's votes on one decision
-- coexist — which is the truth about them. A live founder still cannot vote
-- twice.
--
-- Table rebuild, as SQLite cannot drop a NOT NULL. Same shape as migrations 147
-- and 158: build beside, copy, drop, rename, restore the indexes. No triggers
-- exist on any of the three, which was checked rather than assumed.
-- =============================================================================

PRAGMA foreign_keys=OFF;

-- ─── webhooks: an integration the company may be delivering through ──────────

CREATE TABLE IF NOT EXISTS webhooks_new (
  id TEXT PRIMARY KEY,
  -- Severable. The webhook keeps delivering; it stops naming the person.
  founder_id TEXT REFERENCES founders(id),
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  failure_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_delivery_at DATETIME,
  product_id TEXT,
  created_by TEXT
);

INSERT INTO webhooks_new
SELECT id, founder_id, url, events, secret, active, failure_count, created_at,
       last_delivery_at, product_id, created_by
  FROM webhooks;

DROP TABLE webhooks;
ALTER TABLE webhooks_new RENAME TO webhooks;

CREATE INDEX IF NOT EXISTS idx_webhooks_founder ON webhooks(founder_id);

-- ─── deal_rooms: a shared artefact other people are using ────────────────────

CREATE TABLE IF NOT EXISTS deal_rooms_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Severable. The room stays open for the people using it.
  created_by TEXT REFERENCES founders(id),
  title TEXT NOT NULL,
  description TEXT,
  access_token TEXT UNIQUE NOT NULL,
  decision_ids TEXT,
  expires_at DATETIME,
  view_count INTEGER DEFAULT 0,
  last_viewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO deal_rooms_new
SELECT id, product_id, created_by, title, description, access_token,
       decision_ids, expires_at, view_count, last_viewed_at, created_at
  FROM deal_rooms;

DROP TABLE deal_rooms;
ALTER TABLE deal_rooms_new RENAME TO deal_rooms;

CREATE INDEX IF NOT EXISTS idx_deal_rooms_product ON deal_rooms(product_id);
CREATE INDEX IF NOT EXISTS idx_deal_rooms_token ON deal_rooms(access_token);

-- ─── decision_votes: the company's decision record ───────────────────────────

CREATE TABLE IF NOT EXISTS decision_votes_new (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Severable. The vote was genuinely cast and the record stays truthful about
  -- that; who cast it goes with them.
  founder_id TEXT REFERENCES founders(id),
  vote TEXT CHECK(vote IN ('approve', 'reject', 'abstain', 'needs_more_info')),
  preferred_option TEXT,
  rationale TEXT,
  concerns TEXT,
  voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(decision_id, founder_id)
);

INSERT INTO decision_votes_new
SELECT id, decision_id, product_id, founder_id, vote, preferred_option,
       rationale, concerns, voted_at
  FROM decision_votes;

DROP TABLE decision_votes;
ALTER TABLE decision_votes_new RENAME TO decision_votes;

CREATE INDEX IF NOT EXISTS idx_decision_votes_decision ON decision_votes(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_votes_founder ON decision_votes(founder_id);

PRAGMA foreign_keys=ON;
