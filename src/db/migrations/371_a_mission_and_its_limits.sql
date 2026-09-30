-- =============================================================================
-- 371 — A MISSION, AND THE LIMITS THE OWNER PUTS ON ONE.
--
-- Mission Control (30 September 2026). Most Missions are read from work that
-- already exists (services/mission/read.ts): the search, a test, work for a
-- company, the research. This adds the three things that work could not hold:
--
--   missions        — a goal the owner states that no engine carries yet (a
--                     Build, a portfolio goal), kept verbatim. Identity sealed.
--   mission_terms   — the limits he puts on ANY Mission, read or stated:
--                     budget, end date, what counts as success, what stops it,
--                     how loudly it may interrupt. Superseded, never edited, so
--                     the record says when he raised a budget and from what.
--   mission_events  — what he did to a Mission (confirmed, paused, resumed,
--                     stopped, concluded, archived, amended). Append-only.
--
-- A MISSION GRANTS NOTHING. None of these rows is consulted by any gate that
-- lets Foundry act. A term is a tripwire Foundry watches and brings to him;
-- the hard limits remain the charter, allowances, boundaries and consents.
-- `mission_key` names the row a Mission is a thread through: 'mission:<id>'
-- for one stated here, or 'mandate:', 'experiment:', 'undertaking:',
-- 'thesis:' for one read from work.
-- =============================================================================

CREATE TABLE IF NOT EXISTS missions (
  id          TEXT PRIMARY KEY,
  founder_id  TEXT NOT NULL REFERENCES founders(id),
  product_id  TEXT REFERENCES products(id),
  asked       TEXT NOT NULL,
  goal        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('explore','validate','build','operate','optimize','monitor')),
  realm       TEXT NOT NULL DEFAULT 'real' CHECK (realm IN ('real','paper','simulation')),
  supersedes  TEXT REFERENCES missions(id),
  opened_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_missions_founder ON missions(founder_id, opened_at);

CREATE TRIGGER IF NOT EXISTS mission_is_sealed
BEFORE UPDATE ON missions
BEGIN
  SELECT RAISE(ABORT, 'mission: a stated Mission is kept as it was said; amend its terms instead');
END;

CREATE TABLE IF NOT EXISTS mission_terms (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  mission_key     TEXT NOT NULL,
  budget_cents    INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),
  until           TEXT,
  success         TEXT,
  stop_when       TEXT,
  interrupt_at    TEXT NOT NULL DEFAULT 'needs_you' CHECK (interrupt_at IN ('silent','today','needs_you','urgent')),
  said_at         TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mission_terms_key ON mission_terms(founder_id, mission_key, said_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_terms_one_live ON mission_terms(founder_id, mission_key) WHERE superseded_by IS NULL;

CREATE TRIGGER IF NOT EXISTS mission_terms_are_superseded_never_edited
BEFORE UPDATE ON mission_terms
WHEN NEW.id IS NOT OLD.id OR NEW.founder_id IS NOT OLD.founder_id OR NEW.mission_key IS NOT OLD.mission_key
  OR NEW.budget_cents IS NOT OLD.budget_cents OR NEW.until IS NOT OLD.until OR NEW.success IS NOT OLD.success
  OR NEW.stop_when IS NOT OLD.stop_when OR NEW.interrupt_at IS NOT OLD.interrupt_at OR NEW.said_at IS NOT OLD.said_at
  OR OLD.superseded_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'mission_terms: superseded, never edited');
END;

CREATE TABLE IF NOT EXISTS mission_events (
  id           TEXT PRIMARY KEY,
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  mission_key  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('confirmed','paused','resumed','amended','stopped','concluded','archived')),
  said         TEXT NOT NULL,
  at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_events_key ON mission_events(founder_id, mission_key, at);

CREATE TRIGGER IF NOT EXISTS mission_events_are_kept
BEFORE UPDATE ON mission_events
BEGIN
  SELECT RAISE(ABORT, 'mission_events: what the owner did is kept as it was');
END;
