-- =============================================================================
-- A SEED IS NOT A CANDIDATE
--
-- Discovery usually begins with one weak signal, and the institution needs
-- something to organise the next investigation around. Refusing to hold that
-- object until two sources agree would mean never starting; calling it a
-- venture candidate would mean believing it. So there are two things.
--
-- AN OPPORTUNITY SEED MEANS ONLY: THIS MAY BE WORTH INVESTIGATING. It may come
-- from one real observation, an unresolved portfolio need, a pattern across
-- evidence already held, or from reasoning - and a seed is never evidence that
-- an opportunity exists. That last case is the one worth naming: the model may
-- generate questions and hypotheses; it may not generate the facts that
-- validate them. A reasoned seed therefore starts with nothing and must earn
-- every stance from the world.
--
-- A VENTURE CANDIDATE IS STRONGER, and promotion requires INDEPENDENT
-- EPISTEMIC STANCES rather than a count of sources. Two APIs can tell us the
-- same thing; two communities can repeat one story. What makes evidence
-- independent is that it is a different WAY OF KNOWING - that people hurt, that
-- something already solves it, that somebody is asking money for it, that an
-- organisation is paying labour against it. A registry read twice is still one
-- way of knowing.
--
-- MOST SEEDS SHOULD DIE, and that is the system working. The graveyard already
-- keeps what was rejected and what would make it worth another look.
-- =============================================================================

CREATE TABLE epistemic_stances (
  stance       TEXT PRIMARY KEY,
  what_it_says TEXT NOT NULL,
  -- Why it is not the same as the others, said plainly, because the whole
  -- value of the list is that its members cannot substitute for one another.
  not_the_same_as TEXT NOT NULL,
  sort_order   INTEGER NOT NULL
);

INSERT INTO epistemic_stances (stance, what_it_says, not_the_same_as, sort_order) VALUES
  ('problem_pain', 'people describe something as hurting',
   'evidence that they would pay to stop it hurting', 1),
  ('behaviour_workaround', 'people are already doing something awkward instead',
   'people saying it is annoying, which is cheaper to say than to act on', 2),
  ('substitute', 'something already exists that addresses this',
   'evidence that the existing thing is any good', 3),
  ('satisfaction', 'what fails in the things that already exist',
   'that a gap is worth a business', 4),
  ('asking_price', 'somebody is asking money for it',
   'evidence that anybody pays the asking price', 5),
  ('transaction', 'something actually sold',
   'that it sold at a price worth having', 6),
  ('usage', 'measured use of something, from a system of record',
   'people, since a machine can install a thing every night', 7),
  ('demand_signal', 'people are looking for this',
   'people intending to buy it', 8),
  ('procurement_labour', 'an organisation is paying money or labour against it',
   'that they would pay a stranger instead of an employee', 9),
  ('customer_conversation', 'somebody with the problem said something, asked directly',
   'a representative view, since whoever answered chose to', 10),
  ('stated_preference', 'a group said what they would do when asked',
   'what they will actually do', 11),
  ('behaviour_test', 'people shown a real offer acted, or did not',
   'evidence the behaviour holds at a larger scale', 12),
  ('rehearsal', 'an invented source, for exercising the machinery',
   'anything at all about the world', 13);

CREATE TRIGGER epistemic_stances_constitutional_insert
BEFORE INSERT ON epistemic_stances
BEGIN SELECT RAISE(ABORT,'epistemic_stance:constitutional'); END;
CREATE TRIGGER epistemic_stances_constitutional_update
BEFORE UPDATE ON epistemic_stances
BEGIN SELECT RAISE(ABORT,'epistemic_stance:constitutional'); END;
CREATE TRIGGER epistemic_stances_constitutional_delete
BEFORE DELETE ON epistemic_stances
BEGIN SELECT RAISE(ABORT,'epistemic_stance:constitutional'); END;

-- WHICH WAY OF KNOWING EACH KIND OF SOURCE SUPPLIES.
--
-- Derived from the source type rather than declared per observation, and that
-- is the point: a caller who could name the stance could manufacture
-- independence by claiming a second one. A package registry can only ever tell
-- us what exists, however it is asked.
DROP TRIGGER market_source_types_constitutional_update;
ALTER TABLE market_source_types ADD COLUMN epistemic_stance TEXT
  REFERENCES epistemic_stances(stance);

UPDATE market_source_types SET epistemic_stance = 'substitute'
 WHERE source_type IN ('vendor_site', 'directory', 'app_store');
UPDATE market_source_types SET epistemic_stance = 'asking_price' WHERE source_type = 'pricing_page';
UPDATE market_source_types SET epistemic_stance = 'satisfaction' WHERE source_type = 'review';
UPDATE market_source_types SET epistemic_stance = 'problem_pain' WHERE source_type = 'community';
UPDATE market_source_types SET epistemic_stance = 'transaction' WHERE source_type = 'marketplace';
UPDATE market_source_types SET epistemic_stance = 'usage'
 WHERE source_type IN ('public_dataset', 'provider_api');
UPDATE market_source_types SET epistemic_stance = 'demand_signal' WHERE source_type = 'search_evidence';
UPDATE market_source_types SET epistemic_stance = 'procurement_labour' WHERE source_type = 'job_posting';
UPDATE market_source_types SET epistemic_stance = 'behaviour_workaround' WHERE source_type = 'news';
UPDATE market_source_types SET epistemic_stance = 'customer_conversation'
 WHERE source_type = 'customer_conversation';
UPDATE market_source_types SET epistemic_stance = 'stated_preference' WHERE source_type = 'survey';
UPDATE market_source_types SET epistemic_stance = 'behaviour_test'
 WHERE source_type IN ('landing_page_test', 'ad_experiment');
UPDATE market_source_types SET epistemic_stance = 'rehearsal' WHERE source_type = 'reference_world';

CREATE TRIGGER market_source_types_constitutional_update
BEFORE UPDATE ON market_source_types
BEGIN SELECT RAISE(ABORT,'market_source_type:constitutional'); END;

-- THIS MAY BE WORTH INVESTIGATING, AND NOTHING MORE.
CREATE TABLE opportunity_seeds (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  mandate_id     TEXT REFERENCES venture_mandates(id),
  -- One sentence: what might be worth looking into.
  seed           TEXT NOT NULL,
  -- WHERE THE LOOKING STARTED. Preserved so synthesis can never sever a
  -- venture from the thing that made anybody curious.
  origin         TEXT NOT NULL CHECK (origin IN
                   ('signal','portfolio_need','pattern','reasoned')),
  -- The observation, the need, or the reasoning, in the words that started it.
  origin_said    TEXT NOT NULL,
  -- The real observation it came from, when it came from one.
  origin_observation_id TEXT REFERENCES market_observations(id),
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  sown_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Where it went. A seed that is still open has neither.
  promoted_to    TEXT REFERENCES venture_opportunities(id),
  buried_at      TEXT,
  buried_because TEXT
);

CREATE TRIGGER opportunity_seed_guard
BEFORE INSERT ON opportunity_seeds
BEGIN
  SELECT RAISE(ABORT,'opportunity_seed:incomplete')
    WHERE trim(NEW.seed) = '' OR trim(NEW.origin_said) = '';
  SELECT RAISE(ABORT,'opportunity_seed:cannot_arrive_decided')
    WHERE NEW.promoted_to IS NOT NULL OR NEW.buried_at IS NOT NULL;
  -- A SEED FROM A SIGNAL NAMES THE SIGNAL. Without this "origin: signal" is a
  -- word rather than a link, and the chain back to the evidence breaks at the
  -- first step.
  SELECT RAISE(ABORT,'opportunity_seed:signal_without_an_observation')
    WHERE NEW.origin = 'signal' AND NEW.origin_observation_id IS NULL;
  -- AND A REASONED SEED NAMES NONE. It is a hypothesis; attaching an
  -- observation to it would dress reasoning as evidence, which is the one
  -- thing this table exists to prevent.
  SELECT RAISE(ABORT,'opportunity_seed:reasoning_is_not_evidence')
    WHERE NEW.origin = 'reasoned' AND NEW.origin_observation_id IS NOT NULL;
END;

CREATE TRIGGER opportunity_seed_decided_once
BEFORE UPDATE ON opportunity_seeds
BEGIN
  SELECT RAISE(ABORT,'opportunity_seed:already_decided')
    WHERE OLD.promoted_to IS NOT NULL OR OLD.buried_at IS NOT NULL;
  SELECT RAISE(ABORT,'opportunity_seed:immutable')
    WHERE NEW.seed IS NOT OLD.seed OR NEW.origin IS NOT OLD.origin
       OR NEW.origin_said IS NOT OLD.origin_said
       OR NEW.founder_id IS NOT OLD.founder_id;
  SELECT RAISE(ABORT,'opportunity_seed:burial_needs_a_reason')
    WHERE NEW.buried_at IS NOT NULL AND trim(coalesce(NEW.buried_because,'')) = '';
  SELECT RAISE(ABORT,'opportunity_seed:cannot_be_both')
    WHERE NEW.promoted_to IS NOT NULL AND NEW.buried_at IS NOT NULL;
END;

CREATE INDEX idx_opportunity_seeds_open ON opportunity_seeds(founder_id)
  WHERE promoted_to IS NULL AND buried_at IS NULL;

-- A claim belongs to the seed it was formed to investigate, so the independent
-- ways of knowing can be counted over the evidence that actually bears on this
-- idea rather than over everything the institution has ever seen.
ALTER TABLE market_claims ADD COLUMN seed_id TEXT REFERENCES opportunity_seeds(id);

-- A candidate remembers the seed it grew from, so the chain stays walkable:
-- portfolio need or signal, seed, questions, observations, claims, candidate.
ALTER TABLE venture_opportunities ADD COLUMN from_seed_id TEXT
  REFERENCES opportunity_seeds(id);
