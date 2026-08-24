-- =============================================================================
-- Migration 214: `decisions.outcome_valence` is three values, and says so
--
-- Every reader treats this column as a three-value vocabulary: 1 is positive,
-- -1 is negative, and anything else is neutral. The trust ledger counts
-- `outcome_valence = 1` as a positive outcome and everything else as a decided
-- one, which is how a category earns a gate; the pattern generator and the
-- prediction-accuracy job map it the same way; and the board packet averages it
-- and maps the mean through `((avg + 1) / 2) * 100`, so a single valence of 5
-- would print a decision score of 300% in the document that goes to a board.
--
-- The founder's own form offers exactly three radio buttons: Worked, Mixed,
-- Didn't work. But `POST /decisions/:id/outcome` took `Number(body.valence)`
-- with no check, and the column had no constraint — so any number at all could
-- be stored, and would be read as "neutral" by three readers and as "not
-- positive" by the one that decides how much authority Foundry is given.
--
-- The route validates now. This is the same rule at the database, because a
-- vocabulary enforced only at one door is a vocabulary until somebody adds a
-- second door — which is what `check-check-vocabularies` exists to notice and
-- cannot, since the value arrives as a bound parameter rather than a literal.
--
-- A TRIGGER RATHER THAN A CHECK: SQLite cannot add a CHECK constraint to an
-- existing table without rebuilding it, and `decisions` is wide, indexed and
-- referenced. `RAISE(ABORT, '<domain>:<reason>')` is this codebase's form.
--
-- EXISTING ROWS ARE NOT TOUCHED. Anything already stored outside the vocabulary
-- was written before this rule and is left where a reader can still see it;
-- what changes is that nothing new can be.
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS decisions_outcome_valence_vocabulary_insert
BEFORE INSERT ON decisions
WHEN NEW.outcome_valence IS NOT NULL AND NEW.outcome_valence NOT IN (-1, 0, 1)
BEGIN
  SELECT RAISE(ABORT, 'outcome_valence:not_in_vocabulary');
END;

CREATE TRIGGER IF NOT EXISTS decisions_outcome_valence_vocabulary_update
BEFORE UPDATE OF outcome_valence ON decisions
WHEN NEW.outcome_valence IS NOT NULL AND NEW.outcome_valence NOT IN (-1, 0, 1)
BEGIN
  SELECT RAISE(ABORT, 'outcome_valence:not_in_vocabulary');
END;
