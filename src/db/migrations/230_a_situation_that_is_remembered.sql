-- =============================================================================
-- A SITUATION THAT IS REMEMBERED
--
-- `whatSituation()` diagnoses a company — falling, churning, growing, blind —
-- and then forgets. It is recomputed on every page load and stored nowhere, so
-- the institution cannot answer any of the questions that come after a
-- diagnosis:
--
--   How long has it been like this?
--   When did it change, and what did it change from?
--   We said something about it — did anything happen afterwards?
--   Which of my companies is in the worst shape, and for the longest?
--
-- Every one of those needs the diagnosis to be a THING THAT PERSISTS rather
-- than a value returned from a function. That is what this is: not a new kind
-- of intelligence, but the memory the intelligence already produced needed in
-- order to become a chain — situation, recommendation, outcome, learning,
-- comparison.
--
-- RECORDED WHEN IT CHANGES, NOT WHEN IT IS ASKED. A row per page load would be
-- a log, and a log of the same answer eight hundred times says nothing about
-- duration. One row per SPELL — it began here, it ended there, it became this —
-- is what makes "twenty-three days" and "it stopped after you did that"
-- arithmetic instead of narrative.
--
-- AND THE PROVENANCE TRAVELS WITH IT. A situation diagnosed from the reference
-- world's readings is a fact about a company that does not exist, and a
-- portfolio roll-up that mixed those with real ones would be exactly the
-- corruption migrations 222, 223 and 227 exist to prevent. The mode of the
-- evidence is on the row, so every count downstream can say which world it is
-- counting.
-- =============================================================================

CREATE TABLE company_situations (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id),
  situation      TEXT NOT NULL,
  -- The sentence the owner was shown. Kept verbatim so that a later change to
  -- the wording does not rewrite what he was told at the time.
  headline       TEXT NOT NULL,
  -- What it was derived from, as a JSON array of sentences.
  because_json   TEXT NOT NULL DEFAULT '[]',
  -- Which world the readings came from. A situation is only ever as real as
  -- the evidence under it.
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  began_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at       TEXT,
  -- What it became. A spell that ends without saying what followed leaves the
  -- one question the record exists to answer unanswered.
  ended_as       TEXT
);

-- ONE OPEN SPELL PER COMPANY. A company in two situations at once is not a
-- diagnosis; it is two diagnoses nobody reconciled.
CREATE UNIQUE INDEX idx_company_situation_open
  ON company_situations(product_id) WHERE ended_at IS NULL;

CREATE TRIGGER company_situation_guard
BEFORE INSERT ON company_situations
BEGIN
  SELECT RAISE(ABORT,'company_situation:incomplete')
    WHERE trim(NEW.situation) = '' OR trim(NEW.headline) = '';
  SELECT RAISE(ABORT,'company_situation:because_invalid')
    WHERE json_valid(NEW.because_json) = 0 OR json_type(NEW.because_json) <> 'array';
  SELECT RAISE(ABORT,'company_situation:cannot_arrive_ended')
    WHERE NEW.ended_at IS NOT NULL;
  -- A REFERENCE COMPANY'S SITUATION IS ALWAYS REFERENCE EVIDENCE, whatever the
  -- caller believes. Same shape as migration 223: the guarantee cannot depend
  -- on the writer having got it right.
  SELECT RAISE(ABORT,'company_situation:evidence_mode_mismatch')
    WHERE (NEW.evidence_mode = 'reference') <> EXISTS (
      SELECT 1 FROM products WHERE id = NEW.product_id AND reality = 'reference');
END;

CREATE TRIGGER company_situation_ends_once
BEFORE UPDATE ON company_situations
BEGIN
  SELECT RAISE(ABORT,'company_situation:already_ended')
    WHERE OLD.ended_at IS NOT NULL;
  SELECT RAISE(ABORT,'company_situation:end_needs_successor')
    WHERE NEW.ended_at IS NOT NULL AND trim(coalesce(NEW.ended_as,'')) = '';
  SELECT RAISE(ABORT,'company_situation:immutable')
    WHERE NEW.product_id IS NOT OLD.product_id
       OR NEW.situation IS NOT OLD.situation
       OR NEW.headline IS NOT OLD.headline
       OR NEW.began_at IS NOT OLD.began_at
       OR NEW.evidence_mode IS NOT OLD.evidence_mode;
END;

CREATE TRIGGER company_situation_no_delete
BEFORE DELETE ON company_situations
BEGIN
  SELECT RAISE(ABORT,'company_situation:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE INDEX idx_company_situations_history
  ON company_situations(product_id, began_at);

-- WHAT FOUNDRY WOULD DO ABOUT IT.
--
-- A diagnosis the owner can do nothing with is a diagnosis that wastes his
-- attention. "Revenue is falling" is where most software stops; what he needs
-- next is what would be done about it, what it would cost, and what it would
-- need from him.
--
-- A RECOMMENDATION IS NOT AN ACT, and nothing here can become one. It is a
-- sentence with a decision attached. Where hands exist, the act path is
-- `proposed_acts` (migration 228) with its owner-bound approval; where they do
-- not, accepting a recommendation records that he agreed with it and nothing
-- else happens. Blurring those would let "good idea" become "go ahead".
CREATE TABLE situation_recommendations (
  id             TEXT PRIMARY KEY,
  situation_id   TEXT NOT NULL REFERENCES company_situations(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  -- The kind of thing recommended, from a closed vocabulary, so that "what
  -- followed the last six times we said this" is a question with an answer.
  kind           TEXT NOT NULL,
  summary        TEXT NOT NULL,
  why            TEXT NOT NULL,
  -- What Foundry would need in order to do it — a sense it lacks, an authority
  -- it does not have, or nothing.
  would_need     TEXT NOT NULL,
  raised_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at     TEXT,
  decided_by     TEXT,
  decision       TEXT CHECK (decision IN ('accepted','declined'))
);

CREATE TRIGGER situation_recommendation_guard
BEFORE INSERT ON situation_recommendations
BEGIN
  SELECT RAISE(ABORT,'recommendation:incomplete')
    WHERE trim(NEW.kind) = '' OR trim(NEW.summary) = ''
       OR trim(NEW.why) = '' OR trim(NEW.would_need) = '';
  SELECT RAISE(ABORT,'recommendation:cannot_arrive_decided')
    WHERE NEW.decision IS NOT NULL OR NEW.decided_at IS NOT NULL;
  -- Against an open spell only. Recommending something about a situation that
  -- has already ended is advice about the past.
  SELECT RAISE(ABORT,'recommendation:situation_closed') WHERE NOT EXISTS (
    SELECT 1 FROM company_situations s
     WHERE s.id = NEW.situation_id AND s.product_id = NEW.product_id
       AND s.ended_at IS NULL);
END;

CREATE TRIGGER situation_recommendation_decided_once
BEFORE UPDATE ON situation_recommendations
BEGIN
  SELECT RAISE(ABORT,'recommendation:already_decided')
    WHERE OLD.decision IS NOT NULL;
  -- THE OWNER OF THIS COMPANY, resolved by the database, exactly as
  -- migration 228 does for a proposed act.
  SELECT RAISE(ABORT,'recommendation:not_the_owner')
    WHERE NEW.decision IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM products p
       WHERE p.id = NEW.product_id AND NEW.decided_by = 'founder:' || p.owner_id);
  SELECT RAISE(ABORT,'recommendation:immutable')
    WHERE NEW.kind IS NOT OLD.kind OR NEW.summary IS NOT OLD.summary
       OR NEW.why IS NOT OLD.why OR NEW.situation_id IS NOT OLD.situation_id
       OR NEW.product_id IS NOT OLD.product_id;
END;

CREATE TRIGGER situation_recommendation_no_delete
BEFORE DELETE ON situation_recommendations
BEGIN
  SELECT RAISE(ABORT,'recommendation:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

-- One recommendation of a kind per spell. Saying the same thing twice about one
-- situation is not more advice.
CREATE UNIQUE INDEX idx_recommendation_once_per_spell
  ON situation_recommendations(situation_id, kind);
