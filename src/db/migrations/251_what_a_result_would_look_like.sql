-- =============================================================================
-- WHAT A RESULT WOULD LOOK LIKE
--
-- The institution can now say "I have stopped reading; the only thing left is
-- what people will actually do". It could not then say what to do about it,
-- which leaves the most useful sentence in the research chain hanging one word
-- short of an action.
--
-- An experiment may not be proposed without a way to be wrong - that rule
-- predates this and stays. So proposing one automatically means the
-- institution has to be able to state a falsifiable expectation, and it must
-- not invent one. The honest source is the question itself: "whether anybody
-- would pay" has a shape a result takes, and so does its negation, and both are
-- properties of the KIND of question rather than of any particular candidate.
--
-- So the constitutional list of what reading cannot settle now carries them.
-- Adding a question here is still a migration and a conversation, and now it
-- costs two more sentences: what a supporting result looks like, and what would
-- mean we were wrong. A question nobody can write those for does not belong on
-- this list, because it is not a question an experiment could settle either.
-- =============================================================================

DROP TRIGGER reality_only_questions_constitutional_insert;
DROP TRIGGER reality_only_questions_constitutional_update;

ALTER TABLE reality_only_questions ADD COLUMN looks_like TEXT NOT NULL DEFAULT '';
ALTER TABLE reality_only_questions ADD COLUMN would_be_wrong_if TEXT NOT NULL DEFAULT '';

UPDATE reality_only_questions SET
  looks_like = 'at least one person hands over money at the price offered',
  would_be_wrong_if = 'nobody pays, or everybody asks for it free'
 WHERE pattern IN ('would pay', 'will pay', 'anyone pays', 'willing to pay');

UPDATE reality_only_questions SET
  looks_like = 'somebody using the alternative moves to this one',
  would_be_wrong_if = 'they say it is better and keep what they have'
 WHERE pattern IN ('would switch', 'will switch');

UPDATE reality_only_questions SET
  looks_like = 'people shown the offer act on it rather than passing over it',
  would_be_wrong_if = 'they see it and do nothing'
 WHERE pattern = 'would click';

UPDATE reality_only_questions SET
  looks_like = 'somebody uses it again the following week without being asked',
  would_be_wrong_if = 'they try it once and never return'
 WHERE pattern = 'would use';

UPDATE reality_only_questions SET
  looks_like = 'a buyer returns for the next one',
  would_be_wrong_if = 'every buyer buys once and never again'
 WHERE pattern = 'come back';

UPDATE reality_only_questions SET
  looks_like = 'the people who started are mostly still here a month later',
  would_be_wrong_if = 'most of them are gone within the month'
 WHERE pattern = 'churn';

CREATE TRIGGER reality_only_questions_constitutional_insert
BEFORE INSERT ON reality_only_questions
BEGIN SELECT RAISE(ABORT,'reality_only_question:constitutional'); END;
CREATE TRIGGER reality_only_questions_constitutional_update
BEFORE UPDATE ON reality_only_questions
BEGIN SELECT RAISE(ABORT,'reality_only_question:constitutional'); END;
