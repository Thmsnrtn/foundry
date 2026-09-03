-- =============================================================================
-- A THESIS THAT SURVIVES CONTRADICTION BY GETTING NARROWER
--
-- Two real sources now disagree about the same claim, and the institution
-- refuses to average them. That was the right refusal and it left the thesis
-- stuck: open forever, with nothing to do about it.
--
-- The move a real founder makes is neither averaging nor abandoning. It is
-- narrowing. "Cron scheduling is solved" meets people still describing where
-- it breaks, and becomes "cron scheduling is solved except across daylight
-- saving boundaries" - a smaller claim that both pieces of evidence fit, and a
-- different business.
--
-- SO A CLAIM CAN BE REVISED INTO ANOTHER, AND THE OLD ONE STAYS. It is not
-- deleted and not marked failed: it was not wrong, it was too broad, and the
-- record of having believed it is how the institution learns what kind of
-- claim it tends to make too broadly. The contradiction that forced the
-- revision is named, so nobody later reads the narrower claim as though it
-- had been the idea all along.
--
-- REVISION IS ONE WAY. A claim already revised cannot be revised again into
-- something else - the chain would stop meaning anything - and a revision has
-- to name evidence that actually contradicts the claim it is narrowing.
-- =============================================================================

ALTER TABLE market_claims ADD COLUMN revised_into TEXT REFERENCES market_claims(id);
ALTER TABLE market_claims ADD COLUMN revised_because TEXT;
ALTER TABLE market_claims ADD COLUMN revised_at TEXT;

CREATE TRIGGER market_claim_revision_guard
BEFORE UPDATE OF revised_into ON market_claims
BEGIN
  SELECT RAISE(ABORT,'market_claim:already_revised')
    WHERE OLD.revised_into IS NOT NULL;
  SELECT RAISE(ABORT,'market_claim:revision_needs_a_reason')
    WHERE NEW.revised_into IS NOT NULL AND trim(coalesce(NEW.revised_because,'')) = '';
  -- A CLAIM IS NARROWED BECAUSE SOMETHING CONTRADICTED IT. Narrowing one that
  -- nothing has argued with is not revision, it is changing the subject.
  SELECT RAISE(ABORT,'market_claim:nothing_contradicted_it')
    WHERE NEW.revised_into IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM market_observations o
       WHERE o.claim_id = OLD.id AND o.bearing = 'contradicts');
  SELECT RAISE(ABORT,'market_claim:cannot_revise_into_itself')
    WHERE NEW.revised_into = OLD.id;
  -- A settled claim is finished. Reality answered it; there is nothing to narrow.
  SELECT RAISE(ABORT,'market_claim:settled_claims_are_not_revised')
    WHERE NEW.revised_into IS NOT NULL AND OLD.settled_as IS NOT NULL;
END;

-- =============================================================================
-- AND KNOWING WHEN LOOKING HARDER STOPS HELPING
--
-- Some questions no amount of reading will answer. Whether somebody will pay,
-- whether they will switch, whether they will click, whether they will keep
-- using it - those are answered by contact with reality and by nothing else,
-- and an institution that kept gathering evidence about them would be
-- performing research rather than doing it.
--
-- The constitutional part is the LIST OF WHAT DESK RESEARCH CANNOT SETTLE,
-- because that list is a claim about the world rather than a convenience: it
-- says which questions belong to behaviour instead of to sources. Adding to it
-- is a migration and a conversation.
-- =============================================================================

CREATE TABLE reality_only_questions (
  pattern      TEXT PRIMARY KEY,
  what_it_asks TEXT NOT NULL,
  only_settled_by TEXT NOT NULL,
  sort_order   INTEGER NOT NULL
);

INSERT INTO reality_only_questions (pattern, what_it_asks, only_settled_by, sort_order) VALUES
  ('would pay', 'whether somebody will actually hand over money',
   'showing a price to somebody who has the problem and seeing what they do', 1),
  ('will pay', 'whether somebody will actually hand over money',
   'showing a price to somebody who has the problem and seeing what they do', 2),
  ('anyone pays', 'whether anybody is paying for this at all',
   'a marketplace with visible sales, or asking a seller', 3),
  ('willing to pay', 'what somebody would actually pay',
   'offering it at a price and watching', 4),
  ('would switch', 'whether somebody will leave what they already use',
   'offering the swap to somebody using the alternative', 5),
  ('will switch', 'whether somebody will leave what they already use',
   'offering the swap to somebody using the alternative', 6),
  ('would click', 'whether an offer gets attention',
   'putting the offer somewhere and counting', 7),
  ('would use', 'whether somebody keeps using it after the first day',
   'putting it in front of somebody and watching what happens next', 8),
  ('come back', 'whether somebody returns',
   'shipping something and waiting', 9),
  ('churn', 'whether people stay',
   'having customers for long enough to lose some', 10);

CREATE TRIGGER reality_only_questions_constitutional_insert
BEFORE INSERT ON reality_only_questions
BEGIN SELECT RAISE(ABORT,'reality_only_question:constitutional'); END;
CREATE TRIGGER reality_only_questions_constitutional_update
BEFORE UPDATE ON reality_only_questions
BEGIN SELECT RAISE(ABORT,'reality_only_question:constitutional'); END;
CREATE TRIGGER reality_only_questions_constitutional_delete
BEFORE DELETE ON reality_only_questions
BEGIN SELECT RAISE(ABORT,'reality_only_question:constitutional'); END;
