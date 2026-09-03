-- =============================================================================
-- OBSERVATION IS NOT INTERPRETATION IS NOT HYPOTHESIS
--
-- Discovery can now find real sentences that real people wrote. It cannot yet
-- understand them, and the two honest attempts at understanding them without
-- comprehension both failed in ways worth remembering: naming a seed after the
-- search term produced four ways of writing down what Foundry typed, and
-- extracting content words near the marker produced word salad. Picking nearby
-- nouns is not reading. So a model reads the sentence.
--
-- That is a real widening of what Foundry may do, and it needs a boundary that
-- is structural rather than promised, because the failure mode is severe and
-- quiet: a model paraphrases a source, the paraphrase gets stored, and three
-- steps later the institution believes the source said the paraphrase.
--
-- THREE OBJECTS, NEVER MERGED:
--
--   OBSERVATION    what reality supplied. "Every month I manually check
--                  fourteen licences to see what expires."
--   INTERPRETATION Foundry's reading of what that may indicate. "This may
--                  describe a recurring administrative burden around
--                  licence-renewal tracking."
--   HYPOTHESIS     Foundry's entrepreneurial inference. "A lightweight
--                  monitoring product might reduce that burden."
--
-- Only the first is external evidence. The other two are Foundry's own
-- reasoning, and they live here — in a table that no count of ways-of-knowing
-- reads, so an interpretation can never become one of the independent stances
-- a candidate is believed on.
--
-- MODEL REASONING MAY CREATE interpretations, questions, hypotheses, candidate
-- architectures, possible segments and possible economic forms. MODEL REASONING
-- MAY NOT CREATE customer pain, market demand, willingness to pay, usage,
-- substitute quality or pricing acceptance. Reality supplies facts. Foundry
-- reasons over them.
--
-- AND THE READING MUST POINT AT THE TEXT. `motivated_by` has to be a verbatim
-- span of what the source actually said, checked by the database rather than
-- trusted. A model that cannot show which words it read cannot file a reading.
-- =============================================================================

-- ─── What an entrepreneurial hypothesis can assert ──────────────────────────
--
-- Needed because of the other half of this tranche: a source can only falsify
-- a hypothesis it is capable of speaking to, and that requires knowing what the
-- hypothesis actually asserts.

CREATE TABLE hypothesis_kinds (
  kind          TEXT PRIMARY KEY,
  -- What a hypothesis of this kind claims.
  asserts       TEXT NOT NULL,
  -- What would have to be true in the world for it to hold.
  true_when     TEXT NOT NULL,
  sort_order    INTEGER NOT NULL
);

INSERT INTO hypothesis_kinds (kind, asserts, true_when, sort_order) VALUES
  ('pain_exists', 'that some work is burdensome enough that people would want it gone',
   'people who do the work describe it as costing them time, money or attention', 1),
  ('gap_exists', 'that nothing adequate already addresses it',
   'what exists is absent, abandoned, or does something materially different', 2),
  ('people_pay', 'that somebody already pays money against this work',
   'money is being spent — on a product, a contractor, or an employee''s hours', 3),
  ('enough_people', 'that enough people have this problem for it to be worth serving',
   'the same difficulty appears across different people and places, not one workplace', 4),
  ('lighter_form_possible', 'that the work could be served by something much smaller '
   || 'than what serves it now',
   'the burden is narrow and what people use for it is broad', 5),
  ('reachable', 'that the people with this problem can be reached without buying attention',
   'they gather somewhere, or search for it in words a stranger could guess', 6);

CREATE TRIGGER hypothesis_kinds_constitutional_insert
BEFORE INSERT ON hypothesis_kinds
BEGIN SELECT RAISE(ABORT,'hypothesis_kind:constitutional'); END;
CREATE TRIGGER hypothesis_kinds_constitutional_update
BEFORE UPDATE ON hypothesis_kinds
BEGIN SELECT RAISE(ABORT,'hypothesis_kind:constitutional'); END;
CREATE TRIGGER hypothesis_kinds_constitutional_delete
BEFORE DELETE ON hypothesis_kinds
BEGIN SELECT RAISE(ABORT,'hypothesis_kind:constitutional'); END;

-- ─── What a way of knowing is capable of settling ───────────────────────────
--
-- THE DEFECT THIS FIXES SHIPPED. Weeding asked a package registry about a seed
-- sown from what somebody said, and buried the seed when the registry returned
-- nothing relevant — "investigated, and the world had nothing to say". That is
-- SOURCE TWO EMPTY, THEREFORE BURY, and it is wrong twice over. A registry
-- knows what already exists; it knows nothing whatever about whether the work
-- hurts. And where the hypothesis is that a gap exists, a registry finding
-- nothing maintained is evidence FOR it.
--
-- So a source's bearing on a hypothesis is looked up rather than assumed, and
-- A MISSING ROW MEANS THE SOURCE SAYS NOTHING. Silence is the safe default:
-- a stance whose bearing on a hypothesis has never been established cannot
-- falsify it, which makes the mechanical burial structurally impossible rather
-- than merely discouraged.

CREATE TABLE stance_bearings (
  stance        TEXT NOT NULL REFERENCES epistemic_stances(stance),
  about         TEXT NOT NULL REFERENCES hypothesis_kinds(kind),
  -- 'found' — the source returned things genuinely about the subject.
  -- 'empty'  — it returned nothing relevant.
  when_it       TEXT NOT NULL CHECK (when_it IN ('found','empty')),
  -- What that result does to the hypothesis. There is no 'proves'.
  bearing       TEXT NOT NULL CHECK (bearing IN ('contradicts','supports','narrows')),
  -- Why, in one sentence a reader can disagree with.
  because       TEXT NOT NULL,
  PRIMARY KEY (stance, about, when_it)
);

INSERT INTO stance_bearings (stance, about, when_it, bearing, because) VALUES
  -- The owner's own example, both halves of it.
  ('substitute', 'gap_exists', 'found', 'contradicts',
   'the claim was that nothing adequate exists, and things genuinely about it came back maintained'),
  ('substitute', 'gap_exists', 'empty', 'supports',
   'nothing about it came back, which is what a gap looks like from this direction'),
  ('substitute', 'lighter_form_possible', 'found', 'narrows',
   'what exists shows what the lighter thing would have to be lighter than'),
  ('substitute', 'people_pay', 'found', 'supports',
   'somebody spent effort building for this, which is weak evidence somebody wanted it'),
  -- What people say can speak to pain and to how many, and to nothing else.
  ('problem_pain', 'pain_exists', 'found', 'supports',
   'people doing the work described it as costing them something'),
  ('problem_pain', 'enough_people', 'found', 'narrows',
   'several different people describing it is not a market, but it is more than one workplace'),
  ('problem_pain', 'reachable', 'found', 'narrows',
   'they were found somewhere, which is a place they can be found again'),
  -- Satisfaction speaks to whether the existing thing is any good, which is the
  -- question a substitute source cannot answer about itself.
  ('satisfaction', 'gap_exists', 'found', 'supports',
   'something exists and what people say about it is what is wrong with it'),
  ('asking_price', 'people_pay', 'found', 'narrows',
   'somebody asking a price is not somebody paying it'),
  ('transaction', 'people_pay', 'found', 'supports',
   'something actually sold'),
  ('procurement_labour', 'people_pay', 'found', 'supports',
   'an organisation is paying money or labour against this work'),
  ('usage', 'enough_people', 'found', 'narrows',
   'measured use counts installations, and an installation is not a person');

CREATE TRIGGER stance_bearings_constitutional_insert
BEFORE INSERT ON stance_bearings
BEGIN SELECT RAISE(ABORT,'stance_bearing:constitutional'); END;
CREATE TRIGGER stance_bearings_constitutional_update
BEFORE UPDATE ON stance_bearings
BEGIN SELECT RAISE(ABORT,'stance_bearing:constitutional'); END;
CREATE TRIGGER stance_bearings_constitutional_delete
BEFORE DELETE ON stance_bearings
BEGIN SELECT RAISE(ABORT,'stance_bearing:constitutional'); END;

-- ─── Foundry's reading of one observation ───────────────────────────────────

CREATE TABLE observation_interpretations (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  -- The thing being read. An interpretation with no observation beneath it is
  -- a model having an idea, which belongs in a seed's `reasoned` origin and
  -- not here.
  observation_id  TEXT NOT NULL REFERENCES market_observations(id),

  -- WHAT FOUNDRY THINKS IT MEANS. Null only where it declined to read it.
  reading         TEXT,
  -- WHAT PART OF THE OBSERVATION MOTIVATED THAT READING. A verbatim span of
  -- what the source said, enforced below. This is the column that makes the
  -- reading inspectable rather than assertive.
  motivated_by    TEXT,
  -- WHAT AMBIGUITY REMAINS. Null is allowed and means none was named, which is
  -- itself worth being able to see.
  ambiguity       TEXT,
  -- WHAT OTHER INTERPRETATION IS PLAUSIBLE. The same sentence read differently.
  or_it_could_be  TEXT,
  -- WHAT WOULD SHOW FOUNDRY MISREAD IT. Required, for the same reason an
  -- experiment must name what would disprove it: a reading that cannot be
  -- wrong is not a reading.
  misread_if      TEXT,

  -- THE ENTREPRENEURIAL INFERENCE, kept in its own column because it is a
  -- different kind of thing from the reading. "People find this burdensome" is
  -- a reading. "Something small might sell here" is a hypothesis.
  hypothesis      TEXT,
  hypothesis_kind TEXT REFERENCES hypothesis_kinds(kind),
  -- Who it MAY be, which is a guess about a segment and not a fact about a
  -- customer. Kept because a candidate has to name whose problem it is, and the
  -- honest source of that is the reading rather than a later invention.
  who_it_may_be   TEXT,
  -- The question that would most cheaply settle whether this is nonsense.
  next_question   TEXT,

  -- ABSTENTION IS A VALID AND DESIRABLE OUTCOME. "I cannot infer a coherent
  -- economic problem from this observation" is the right answer most of the
  -- time, and forcing every real sentence into a venture-shaped story is the
  -- failure this whole apparatus exists to prevent.
  abstained_because TEXT,

  -- Which model did the reading, so a bad batch can be found later.
  interpreted_by  TEXT NOT NULL,
  interpreted_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_mode   TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),

  -- Either it read the sentence, in full, or it declined. Never half.
  CHECK (
    (abstained_because IS NOT NULL AND reading IS NULL AND hypothesis IS NULL)
    OR (abstained_because IS NULL AND reading IS NOT NULL AND motivated_by IS NOT NULL
        AND misread_if IS NOT NULL)
  )
);

CREATE INDEX idx_interpretations_observation
  ON observation_interpretations(observation_id);
CREATE INDEX idx_interpretations_founder
  ON observation_interpretations(founder_id, interpreted_at DESC);

-- THE MOTIVATION MUST BE IN THE TEXT.
--
-- This is the structural half of "never paraphrase the source and then store
-- the paraphrase as though the source said it". The reading may be Foundry's
-- own words — that is the point of it — but the words it claims to be reading
-- must actually appear in what the source supplied. A model that summarises
-- the sentence into its citation is refused at the door.
CREATE TRIGGER interpretation_motivation_must_be_quoted
BEFORE INSERT ON observation_interpretations
BEGIN
  SELECT RAISE(ABORT,'interpretation:motivation_not_in_the_observation')
    WHERE NEW.motivated_by IS NOT NULL
      AND instr(
            (SELECT saw FROM market_observations WHERE id = NEW.observation_id),
            NEW.motivated_by
          ) = 0;
  SELECT RAISE(ABORT,'interpretation:motivation_too_short')
    WHERE NEW.motivated_by IS NOT NULL AND length(trim(NEW.motivated_by)) < 12;
  -- A HYPOTHESIS MUST SAY WHAT IT ASSERTS, so a source can later be asked
  -- whether it is even capable of contradicting it.
  SELECT RAISE(ABORT,'interpretation:hypothesis_without_a_kind')
    WHERE NEW.hypothesis IS NOT NULL AND NEW.hypothesis_kind IS NULL;
  -- READING A REHEARSAL MAY NOT PRODUCE A REAL BELIEF. One way, as everywhere
  -- else: the reference world must be able to exercise this machinery.
  SELECT RAISE(ABORT,'interpretation:reference_observation_read_as_real')
    WHERE NEW.evidence_mode <> 'reference'
      AND (SELECT evidence_mode FROM market_observations WHERE id = NEW.observation_id)
          = 'reference';
END;

-- WHAT FOUNDRY THOUGHT BEFORE THE EVIDENCE CAME IN IS NOT EDITABLE.
--
-- Same reason an experiment is sealed at the decision: a reading quietly
-- rewritten once the answer arrives is a record of having been right rather
-- than a record of having thought. A second reading is a second row.
CREATE TRIGGER interpretation_is_sealed
BEFORE UPDATE ON observation_interpretations
BEGIN
  SELECT RAISE(ABORT,'interpretation:sealed')
    WHERE NEW.reading IS NOT OLD.reading
       OR NEW.motivated_by IS NOT OLD.motivated_by
       OR NEW.misread_if IS NOT OLD.misread_if
       OR NEW.hypothesis IS NOT OLD.hypothesis
       OR NEW.hypothesis_kind IS NOT OLD.hypothesis_kind
       OR NEW.abstained_because IS NOT OLD.abstained_because;
END;

-- ─── The seed carries the reading it came from ──────────────────────────────

ALTER TABLE opportunity_seeds ADD COLUMN interpretation_id TEXT
  REFERENCES observation_interpretations(id);

-- What the seed's hypothesis asserts, so weeding can ask whether a source is
-- even capable of contradicting it.
ALTER TABLE opportunity_seeds ADD COLUMN hypothesis_kind TEXT
  REFERENCES hypothesis_kinds(kind);

-- ─── What a source was asked, and what its answer could bear on ─────────────
--
-- Kept because burying a seed on evidence requires being able to show, later,
-- that the evidence was capable of the burial.

CREATE TABLE seed_questionings (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  seed_id         TEXT NOT NULL REFERENCES opportunity_seeds(id),
  -- The stance that was consulted, not the provider. Two registries are one
  -- way of knowing.
  stance          TEXT NOT NULL REFERENCES epistemic_stances(stance),
  -- What was actually asked of it.
  asked           TEXT NOT NULL,
  -- What came back, in the source's terms.
  found           TEXT NOT NULL CHECK (found IN ('found','empty')),
  -- What that does to the seed's hypothesis, looked up rather than assumed.
  -- 'says_nothing' is the value that did not exist before this migration and
  -- is the whole point of it.
  bearing         TEXT NOT NULL
                  CHECK (bearing IN ('contradicts','supports','narrows','says_nothing')),
  because         TEXT NOT NULL,
  asked_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_mode   TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference'))
);

CREATE INDEX idx_seed_questionings_seed ON seed_questionings(seed_id, asked_at DESC);
