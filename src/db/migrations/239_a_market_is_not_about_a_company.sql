-- =============================================================================
-- A MARKET IS NOT ABOUT A COMPANY
--
-- Migration 234 modelled the market as a sense, which was right, and connected
-- senses through `company_senses`, which for this one is wrong. Every other
-- sense answers a question about a particular business: connect Stripe to
-- Northgate and you know Northgate's revenue. A market belongs to nobody's
-- company. Binding it to one would have made "can Foundry see the market" a
-- question with a different answer per business, which is nonsense, and would
-- have quietly scoped a founder-level capability to whichever company happened
-- to connect it first.
--
-- SO A RESEARCH SOURCE BELONGS TO THE PERSON. It names one of the constitutional
-- source types from migration 236 and one concrete thing behind it, and it is
-- the unit in which the market sense arrives: not one switch that turns on
-- "market", but a family of partial ways of looking, each connected, revoked and
-- accounted for on its own. That is what "market is a sense family" means in
-- schema rather than in prose.
--
-- IT ALSO FIXES A SENTENCE THAT WAS WRONG ON THE PAGE. A rehearsal search could
-- produce four candidates while the same screen reported that Foundry could not
-- see the market. Both halves were true of different things and the pairing read
-- as incoherence. A reference mandate now has reference sources; a real one has
-- none, and says so, until something real is connected.
--
-- AND A SOURCE IS STILL NOT A HAND. `never_grants` is required and immutable,
-- for the reason it is required and immutable on every sense: being able to read
-- what people are saying about a market has never once implied permission to
-- write to them.
-- =============================================================================

CREATE TABLE research_sources (
  id             TEXT PRIMARY KEY,
  -- The person, not a company. Carried directly so erasure finds it.
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  source_type    TEXT NOT NULL REFERENCES market_source_types(source_type),
  -- The concrete thing behind the type: a named service, a dataset, a person
  -- who agreed to be asked. Never empty — a source nobody could go back to is
  -- not a source.
  named          TEXT NOT NULL,
  -- What having it never permits. Immutable from the moment it is connected.
  never_grants   TEXT NOT NULL,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  connected_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TEXT
);

CREATE UNIQUE INDEX idx_research_source_one_live
  ON research_sources(founder_id, source_type, named)
  WHERE disconnected_at IS NULL;

CREATE TRIGGER research_source_guard
BEFORE INSERT ON research_sources
BEGIN
  SELECT RAISE(ABORT,'research_source:incomplete')
    WHERE trim(NEW.named) = '' OR trim(NEW.never_grants) = '';
  SELECT RAISE(ABORT,'research_source:cannot_arrive_disconnected')
    WHERE NEW.disconnected_at IS NOT NULL;
  -- An invented source may only ever produce invented evidence. The same
  -- one-way rule migration 236 applies to observations, applied at the door
  -- they would come through.
  SELECT RAISE(ABORT,'research_source:invented_source_is_not_real')
    WHERE NEW.source_type = 'reference_world' AND NEW.evidence_mode <> 'reference';
END;

CREATE TRIGGER research_source_disconnect_is_one_way
BEFORE UPDATE ON research_sources
BEGIN
  SELECT RAISE(ABORT,'research_source:already_disconnected')
    WHERE OLD.disconnected_at IS NOT NULL;
  SELECT RAISE(ABORT,'research_source:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id
       OR NEW.source_type IS NOT OLD.source_type
       OR NEW.named IS NOT OLD.named
       OR NEW.never_grants IS NOT OLD.never_grants
       OR NEW.evidence_mode IS NOT OLD.evidence_mode;
END;

CREATE INDEX idx_research_sources_live
  ON research_sources(founder_id) WHERE disconnected_at IS NULL;
