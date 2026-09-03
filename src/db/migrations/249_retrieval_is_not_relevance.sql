-- =============================================================================
-- RETRIEVAL IS NOT RELEVANCE, AND RELEVANCE IS NOT SUPPORT
--
-- A real source, a real URL and a real date do not make valid evidence for a
-- claim. The institution learnt that the hard way: asked what already existed
-- for "licence renewal deadline reminder", a registry returned fifteen
-- maintained packages - editor extensions, a clipboard helper, a markdown
-- previewer - and the first version filed all fifteen as substitutes with real
-- URLs underneath. Beautifully sourced, and completely false.
--
-- So there are now three things, and each transition between them is kept:
--
--   WHAT THE SOURCE RETURNED       a retrieval: the terms, the URL fetched, how
--                                  many it said it had, how many were examined
--   WHAT WE JUDGED RELEVANT        each returned item, with whether it was
--                                  judged on-subject and the words that decided
--   WHAT A CLAIM CAN REST ON       the observations, each pointing back at the
--                                  retrieval it came from
--
-- Nothing is thrown away between them, so a finding can be argued with rather
-- than trusted. Provenance must never become confidence.
--
-- ABSENCE IS NOT PRESENCE. "No relevant result appeared" must never silently
-- become "nothing relevant exists". A finding that rests on absence is marked
-- as such, and its retrieval carries what would let somebody judge the
-- coverage: what was searched, what that instrument can and cannot see, what
-- the thing might have been called instead, and which OTHER KIND of source
-- would most reduce the doubt. Deliberately no coverage percentage - a number
-- there would be invented precision about the one thing nobody can measure.
-- =============================================================================

CREATE TABLE market_retrievals (
  id                TEXT PRIMARY KEY,
  founder_id        TEXT NOT NULL REFERENCES founders(id),
  source_type       TEXT NOT NULL REFERENCES market_source_types(source_type),
  -- The address actually fetched, so the same question can be asked again.
  source            TEXT NOT NULL,
  -- What was searched for, in the words that were used.
  terms             TEXT NOT NULL,
  -- What the source said it had, which is not what was looked at.
  returned_count    INTEGER NOT NULL,
  -- How many were actually examined.
  examined_count    INTEGER NOT NULL,
  -- How many of those were judged to be about the subject at all.
  relevant_count    INTEGER NOT NULL,
  -- The instrument, described at the time it was used, because what a source
  -- can see changes and a finding has to be readable years later.
  can_see           TEXT NOT NULL,
  cannot_see        TEXT NOT NULL,
  -- What the thing might have been called instead and was not searched for.
  -- Empty is a real answer; it means nobody thought of any, and says so.
  not_also_tried    TEXT,
  -- Which OTHER KIND of source would most reduce the doubt this leaves.
  would_most_help   TEXT NOT NULL,
  retrieved_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_mode     TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference'))
);

CREATE TRIGGER market_retrieval_guard
BEFORE INSERT ON market_retrievals
BEGIN
  SELECT RAISE(ABORT,'market_retrieval:incomplete')
    WHERE trim(NEW.source) = '' OR trim(NEW.terms) = '' OR trim(NEW.can_see) = ''
       OR trim(NEW.cannot_see) = '' OR trim(NEW.would_most_help) = '';
  SELECT RAISE(ABORT,'market_retrieval:counts_are_impossible')
    WHERE NEW.examined_count < 0 OR NEW.relevant_count < 0
       OR NEW.relevant_count > NEW.examined_count;
END;

CREATE TRIGGER market_retrieval_immutable
BEFORE UPDATE ON market_retrievals
BEGIN SELECT RAISE(ABORT,'market_retrieval:immutable'); END;

-- EVERY THING THE SOURCE RETURNED, kept whether or not it was believed. The
-- rejected ones are the important half: they are how somebody checks that the
-- relevance judgement was reasonable rather than convenient.
CREATE TABLE retrieval_items (
  id            TEXT PRIMARY KEY,
  retrieval_id  TEXT NOT NULL REFERENCES market_retrievals(id),
  -- Carried directly rather than reached through the retrieval, because erasure
  -- walks founder columns rather than joins: a table reachable only through a
  -- parent is a table erasure walks past.
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  label         TEXT NOT NULL,
  url           TEXT,
  dated_at      TEXT,
  -- What it says about itself, in its own words, trimmed.
  said          TEXT,
  relevant      INTEGER NOT NULL DEFAULT 0,
  -- The words it shares with the search, which is what decided relevance.
  shared_terms  TEXT
);

CREATE TRIGGER retrieval_item_guard
BEFORE INSERT ON retrieval_items
BEGIN
  SELECT RAISE(ABORT,'retrieval_item:incomplete') WHERE trim(NEW.label) = '';
END;
CREATE TRIGGER retrieval_item_immutable
BEFORE UPDATE ON retrieval_items
BEGIN SELECT RAISE(ABORT,'retrieval_item:immutable'); END;

CREATE INDEX idx_retrieval_items_of ON retrieval_items(retrieval_id);

-- An observation now says where it came from, and whether it rests on absence.
ALTER TABLE market_observations ADD COLUMN retrieval_id TEXT REFERENCES market_retrievals(id);
ALTER TABLE market_observations ADD COLUMN from_absence INTEGER NOT NULL DEFAULT 0;

-- WHAT PEOPLE SAY TO EACH OTHER, which a registry can never tell you.
--
-- A second real source, chosen because it KNOWS DIFFERENTLY rather than because
-- another API was convenient. A registry answers "what exists". A public
-- discussion archive answers "what do people complain about, work around, or
-- give up on" - and those two can disagree, which is the point. A well-served
-- problem with a maintained package can still have people describing the part
-- that hurts, and no amount of registry evidence would ever surface it.
DROP TRIGGER capabilities_constitutional_insert;

INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('read_community_discussion', 'research',
   'read what people said to each other about a problem - what they complain '
   || 'about, what they work around, and where it actually hurts', 'observe', 8);

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_hn_search', 'read_community_discussion', 'hn_algolia', 'api', NULL,
   'nothing - public, no credential, no account', 'declared', 1);
