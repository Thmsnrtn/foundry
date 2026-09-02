-- =============================================================================
-- MARKET IS NOT ONE PROVIDER
--
-- Migration 234 modelled market research as a sense with no provider, and that
-- was right about the refusal and wrong about the shape. Stripe is a single
-- coherent source of truth about one company: connect it and you know the
-- revenue. Nothing is like that about a market.
--
-- Market knowledge accumulates from many partial, dated, disagreeing sources —
-- a pricing page, a forum thread, a review, a job posting, a directory listing,
-- a conversation with somebody who has the problem. None of them is the truth.
-- What they produce, together, is a CLAIM with evidence on both sides and an
-- honest statement of what is still unknown.
--
-- SO THERE IS NO MARKET-TRUTH FEED HERE, and there will not be one. There are
-- observations, which are dated and attributed; and claims, whose standing is
-- derived from the observations rather than asserted. A claim with three
-- supports and one contradiction is a different object from a claim with three
-- supports — and an institution that flattened them would be manufacturing the
-- confidence it was asked to gather.
--
-- THE MODEL MAY REASON OVER EVIDENCE. THE MODEL'S RECOLLECTION IS NOT EVIDENCE.
-- Every observation names a source that could be looked at. There is no source
-- type for "the model remembered this", deliberately: the moment one exists,
-- every downstream count of what is known becomes a count of what was recalled.
--
-- AND IT IS BUILT BEFORE THE SOURCES EXIST, on purpose. The owner's instruction:
-- "no market provider exists" may never become the reason the research
-- institution is unbuilt. Reference evidence exercises collection, provenance,
-- contradiction, unknowns and falsification now; real sources replace it one at
-- a time, through governed senses, without any of this changing shape.
-- =============================================================================

CREATE TABLE market_source_types (
  source_type  TEXT PRIMARY KEY,
  -- What kind of knowing this is, in the owner's words.
  what_it_is   TEXT NOT NULL,
  -- Whether it is somebody's claim about themselves, or something observed
  -- about the world. A vendor's pricing page is authoritative about price and
  -- worthless about whether anyone pays it.
  stance       TEXT NOT NULL CHECK (stance IN ('self_reported','observed','solicited')),
  sort_order   INTEGER NOT NULL
);

INSERT INTO market_source_types (source_type, what_it_is, stance, sort_order) VALUES
  ('vendor_site', 'what a company says about itself', 'self_reported', 1),
  ('pricing_page', 'what a company says it charges', 'self_reported', 2),
  ('review', 'what a customer said in public about using something', 'observed', 3),
  ('community', 'what people said to each other about a problem', 'observed', 4),
  ('directory', 'that something exists and is listed somewhere', 'observed', 5),
  ('marketplace', 'what is sold, and sometimes how much of it', 'observed', 6),
  ('app_store', 'what is published, rated and reviewed', 'observed', 7),
  ('public_dataset', 'a published set of numbers somebody else gathered', 'observed', 8),
  ('search_evidence', 'what people are looking for, and how much', 'observed', 9),
  ('job_posting', 'what a company is paying someone to do, which is what it is doing', 'observed', 10),
  ('news', 'something reported to have happened', 'observed', 11),
  ('provider_api', 'a number from a system of record', 'observed', 12),
  ('customer_conversation', 'what somebody with the problem told us', 'solicited', 13),
  ('survey', 'what a group of people said when asked', 'solicited', 14),
  ('landing_page_test', 'what people did when shown an offer', 'observed', 15),
  ('ad_experiment', 'what it cost to get attention, and what happened next', 'observed', 16),
  ('reference_world', 'an invented source, for exercising the machinery', 'observed', 17);

CREATE TRIGGER market_source_types_constitutional_insert
BEFORE INSERT ON market_source_types
BEGIN SELECT RAISE(ABORT,'market_source_type:constitutional'); END;
CREATE TRIGGER market_source_types_constitutional_update
BEFORE UPDATE ON market_source_types
BEGIN SELECT RAISE(ABORT,'market_source_type:constitutional'); END;
CREATE TRIGGER market_source_types_constitutional_delete
BEFORE DELETE ON market_source_types
BEGIN SELECT RAISE(ABORT,'market_source_type:constitutional'); END;

-- A CLAIM ABOUT THE WORLD, WHOSE STANDING IS DERIVED RATHER THAN ASSERTED.
CREATE TABLE market_claims (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  -- What is being claimed, in one sentence a person could argue with.
  claim          TEXT NOT NULL,
  -- What it is about, when it is about something in particular.
  opportunity_id TEXT REFERENCES venture_opportunities(id),
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  formed_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set when reality settled it, which is not the same as evidence accumulating.
  settled_as     TEXT CHECK (settled_as IN ('held','failed')),
  settled_at     TEXT,
  settled_by     TEXT
);

CREATE TRIGGER market_claim_guard
BEFORE INSERT ON market_claims
BEGIN
  SELECT RAISE(ABORT,'market_claim:incomplete') WHERE trim(NEW.claim) = '';
  SELECT RAISE(ABORT,'market_claim:cannot_arrive_settled')
    WHERE NEW.settled_as IS NOT NULL;
END;

CREATE TRIGGER market_claim_settled_once
BEFORE UPDATE ON market_claims
BEGIN
  SELECT RAISE(ABORT,'market_claim:already_settled') WHERE OLD.settled_as IS NOT NULL;
  SELECT RAISE(ABORT,'market_claim:settlement_needs_a_witness')
    WHERE NEW.settled_as IS NOT NULL AND trim(coalesce(NEW.settled_by,'')) = '';
  SELECT RAISE(ABORT,'market_claim:immutable')
    WHERE NEW.claim IS NOT OLD.claim OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.evidence_mode IS NOT OLD.evidence_mode;
END;

-- ONE THING SOMEBODY SAW, SOMEWHERE, AT A TIME.
--
-- `supports` and `contradicts` are the whole design. An observation that only
-- ever agreed would make evidence a way of accumulating confidence; letting one
-- CONTRADICT a claim is what makes this a research institution rather than a
-- justification engine.
CREATE TABLE market_observations (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  claim_id       TEXT NOT NULL REFERENCES market_claims(id),
  source_type    TEXT NOT NULL REFERENCES market_source_types(source_type),
  -- Where it was seen: a URL, a person, a dataset. Never empty — an observation
  -- nobody could go and look at is not an observation.
  source         TEXT NOT NULL,
  -- What was actually seen, in the words of whoever saw it.
  saw            TEXT NOT NULL,
  -- Which way it cuts.
  bearing        TEXT NOT NULL CHECK (bearing IN ('supports','contradicts')),
  -- Whether it says the thing, or the thing was worked out from it. "Six
  -- competitors charge $49" is direct; "so the market will bear $49" is not.
  directness     TEXT NOT NULL CHECK (directness IN ('direct','inferred')),
  -- WHEN IT WAS TRUE, not when it was filed. A pricing page read a year ago is
  -- evidence about last year, and a claim resting on stale observations should
  -- say so rather than look current.
  observed_at    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference'))
);

CREATE TRIGGER market_observation_guard
BEFORE INSERT ON market_observations
BEGIN
  SELECT RAISE(ABORT,'market_observation:incomplete')
    WHERE trim(NEW.source) = '' OR trim(NEW.saw) = '';
  -- AN INVENTED SOURCE MAY ONLY EVER PRODUCE INVENTED EVIDENCE. One way, and
  -- deliberately not the other: the reference world has to be able to invent a
  -- forum thread, a job posting and a marketplace listing, because what needs
  -- exercising is how DIFFERENT KINDS of source combine and disagree. Forcing
  -- every reference observation to be typed 'reference_world' would have left
  -- the machinery proven against one source type, which is the one shape a
  -- market never has.
  SELECT RAISE(ABORT,'market_observation:invented_source_in_real_evidence')
    WHERE NEW.source_type = 'reference_world' AND NEW.evidence_mode <> 'reference';
  -- The observation is only ever as real as the claim it is attached to.
  SELECT RAISE(ABORT,'market_observation:claim_mode_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM market_claims c
     WHERE c.id = NEW.claim_id
       AND (c.evidence_mode = 'reference') = (NEW.evidence_mode = 'reference'));
END;

-- Observations are never edited or removed: a contradiction somebody deleted is
-- a contradiction that never happened.
CREATE TRIGGER market_observation_immutable
BEFORE UPDATE ON market_observations
BEGIN SELECT RAISE(ABORT,'market_observation:immutable'); END;

-- WHAT IS STILL NOT KNOWN, KEPT AS A FIRST-CLASS THING.
--
-- An unknown that lives in prose gets dropped in the retelling. This one has to
-- be answered or explicitly accepted, and a candidate carrying an unanswered
-- blocking unknown cannot advance however good the rest reads.
CREATE TABLE market_unknowns (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  opportunity_id TEXT REFERENCES venture_opportunities(id),
  claim_id       TEXT REFERENCES market_claims(id),
  question       TEXT NOT NULL,
  -- Whether not knowing this stops a decision, or is merely untidy.
  blocking       INTEGER NOT NULL DEFAULT 0,
  -- The cheapest thing that would answer it. The point of naming an unknown is
  -- to make it resolvable, not to decorate a report with humility.
  cheapest_test  TEXT,
  raised_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at    TEXT,
  answer         TEXT
);

CREATE TRIGGER market_unknown_guard
BEFORE INSERT ON market_unknowns
BEGIN
  SELECT RAISE(ABORT,'market_unknown:question_required') WHERE trim(NEW.question) = '';
  SELECT RAISE(ABORT,'market_unknown:cannot_arrive_answered')
    WHERE NEW.answered_at IS NOT NULL;
END;

CREATE TRIGGER market_unknown_answered_once
BEFORE UPDATE ON market_unknowns
BEGIN
  SELECT RAISE(ABORT,'market_unknown:already_answered') WHERE OLD.answered_at IS NOT NULL;
  SELECT RAISE(ABORT,'market_unknown:answer_required')
    WHERE NEW.answered_at IS NOT NULL AND trim(coalesce(NEW.answer,'')) = '';
  SELECT RAISE(ABORT,'market_unknown:immutable')
    WHERE NEW.question IS NOT OLD.question OR NEW.founder_id IS NOT OLD.founder_id;
END;

CREATE INDEX idx_market_observations_claim ON market_observations(claim_id, bearing);
CREATE INDEX idx_market_unknowns_open
  ON market_unknowns(opportunity_id) WHERE answered_at IS NULL;
