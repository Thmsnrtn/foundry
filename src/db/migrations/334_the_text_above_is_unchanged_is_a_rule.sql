-- =============================================================================
-- "THE TEXT ABOVE IS UNCHANGED" IS A RULE, NOT A CLAIM
--
-- Migration 333 published a dated footnote beneath Experiment 001's record and
-- wrote three rules to keep the record beneath it still. An adversarial reading
-- executed SQL against those rules and got through all three, four different
-- ways. Every one of them is below, and every one is now refused.
--
-- WHAT THE HOLES WERE, said plainly because the shape of the mistake is the
-- reusable part:
--
--   1. THE LIST WAS SHORT. The "nothing sealed moves in the same statement"
--      rule named nine columns and missed three — `public_sample`,
--      `graduated_to_url` and `listed`. The worst of those is not the sample:
--      setting `graduated_to_url` flips the page's status to "Graduated — this
--      experiment now operates independently", so a single legal statement
--      could publish the correction AND present the failed test as a success,
--      inside the statement the rule existed to police. An enumeration is only
--      as good as the person who wrote it was tired.
--
--   2. THE RULE WAS KEYED ON THE WRONG EVENT. It fired only when the
--      clarification column itself changed, so the sealed copy was frozen for
--      exactly one statement and free for every statement afterwards — and two
--      exported functions, `updatePublicCopy` and `recordPublicOutcome`, do
--      precisely that in the ordinary course of business. The footnote's own
--      last sentence, "The text above is unchanged", was enforced by nothing.
--      It happened to be true.
--
--   3. DELETE WAS NOT A WRITE. There was no BEFORE DELETE trigger, and the
--      INSERT guard said nothing about clarifications. Delete the row, insert
--      it again with the same number and slug and no footnote, and the
--      correction is gone without a trace — or back with different words, any
--      date, or none.
--
--   4. THE DATE COULD MOVE ALONE. Rule three refused a rewording that kept its
--      date and said, in its own comment, that changing the text requires the
--      date to move with it "so a reader can always tell that it did". The
--      date could be moved by itself, silently — a footnote published on the
--      21st redated to the 8th, so that a defect disclosed after settlement
--      appears to have been disclosed before it.
--
-- THE RULE THAT REPLACES THEM IS ONE SENTENCE AND IS NOT AN ENUMERATION OF
-- WAYS TO CHEAT. Once a clarification is published, the record beneath it is
-- frozen: no sealed column may change, by any statement, for any reason, and
-- the row cannot be deleted. A correction is allowed to supersede itself, with
-- new words AND a new date together, and that is the only thing that may move.
--
-- This costs something and the cost is the right way round. A typo in the
-- sealed copy of a clarified record can no longer be fixed in place; it needs
-- a second dated footnote. That is what it means for a record to be a record.
-- =============================================================================

DROP TRIGGER IF EXISTS public_experiment_identity_is_durable;

CREATE TRIGGER public_experiment_identity_is_durable
BEFORE UPDATE ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:identity_is_durable')
    WHERE NEW.experiment_id IS NOT OLD.experiment_id OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.number IS NOT OLD.number OR NEW.slug IS NOT OLD.slug
       OR NEW.supersedes_experiment_id IS NOT OLD.supersedes_experiment_id;

  -- A public outcome is written about a test that has ended: settled, stopped
  -- or declined. Writing one earlier would be a prediction dressed as a result.
  SELECT RAISE(ABORT,'public_experiment:outcome_needs_an_ended_test')
    WHERE NEW.public_outcome IS NOT NULL AND NEW.public_outcome IS NOT OLD.public_outcome AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id
        AND (e.ran_at IS NOT NULL OR e.decision = 'declined' OR e.validity = 'invalid'
             OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL)));

  -- A LATER FINDING IS ABOUT A TEST THAT HAS ENDED, for the same reason.
  SELECT RAISE(ABORT,'public_experiment:clarification_needs_an_ended_test')
    WHERE NEW.public_clarification IS NOT NULL
      AND NEW.public_clarification IS NOT OLD.public_clarification AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id
        AND (e.ran_at IS NOT NULL OR e.decision = 'declined' OR e.validity = 'invalid'
             OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL)));

  SELECT RAISE(ABORT,'public_experiment:clarification_needs_a_date')
    WHERE (NEW.public_clarification IS NULL) <> (NEW.public_clarification_at IS NULL);
  SELECT RAISE(ABORT,'public_experiment:clarification_is_empty')
    WHERE NEW.public_clarification IS NOT NULL AND trim(NEW.public_clarification) = '';

  -- ONCE THERE IS A FOOTNOTE, THE RECORD BENEATH IT IS FROZEN — by ANY
  -- statement, not merely by the one that writes the footnote. This is the
  -- rule the sentence "The text above is unchanged" actually needs, and every
  -- column that renders above the footnote is in it, including the three the
  -- first version missed and the two that decide what the page CALLS itself.
  SELECT RAISE(ABORT,'public_experiment:the_text_above_is_unchanged')
    WHERE OLD.public_clarification IS NOT NULL
      AND (NEW.public_title IS NOT OLD.public_title
        OR NEW.public_summary IS NOT OLD.public_summary
        OR NEW.public_who IS NOT OLD.public_who
        OR NEW.public_what IS NOT OLD.public_what
        OR NEW.public_limits IS NOT OLD.public_limits
        OR NEW.public_sources IS NOT OLD.public_sources
        OR NEW.public_selection IS NOT OLD.public_selection
        OR NEW.public_note IS NOT OLD.public_note
        OR NEW.public_sample IS NOT OLD.public_sample
        OR NEW.public_outcome IS NOT OLD.public_outcome
        OR NEW.graduated_to_url IS NOT OLD.graduated_to_url
        OR NEW.listed IS NOT OLD.listed);

  -- And the statement that FIRST publishes one may not carry an edit either,
  -- because at that moment OLD has no clarification and the rule above is
  -- silent. Same list, same reason.
  SELECT RAISE(ABORT,'public_experiment:a_clarification_does_not_edit_the_record')
    WHERE NEW.public_clarification IS NOT OLD.public_clarification
      AND (NEW.public_title IS NOT OLD.public_title
        OR NEW.public_summary IS NOT OLD.public_summary
        OR NEW.public_who IS NOT OLD.public_who
        OR NEW.public_what IS NOT OLD.public_what
        OR NEW.public_limits IS NOT OLD.public_limits
        OR NEW.public_sources IS NOT OLD.public_sources
        OR NEW.public_selection IS NOT OLD.public_selection
        OR NEW.public_note IS NOT OLD.public_note
        OR NEW.public_sample IS NOT OLD.public_sample
        OR NEW.public_outcome IS NOT OLD.public_outcome
        OR NEW.graduated_to_url IS NOT OLD.graduated_to_url
        OR NEW.listed IS NOT OLD.listed);

  SELECT RAISE(ABORT,'public_experiment:a_clarification_is_not_withdrawn')
    WHERE OLD.public_clarification IS NOT NULL AND NEW.public_clarification IS NULL;

  -- A CORRECTION MAY SUPERSEDE ITSELF, AND ONLY TOGETHER. New words need a new
  -- date, and a new date needs new words — the second half is what stops a
  -- footnote published after settlement being redated to look as though it came
  -- before.
  SELECT RAISE(ABORT,'public_experiment:a_reworded_clarification_is_a_new_one')
    WHERE OLD.public_clarification IS NOT NULL
      AND NEW.public_clarification IS NOT OLD.public_clarification
      AND NEW.public_clarification_at IS OLD.public_clarification_at;
  SELECT RAISE(ABORT,'public_experiment:a_date_does_not_move_on_its_own')
    WHERE OLD.public_clarification IS NOT NULL
      AND NEW.public_clarification_at IS NOT OLD.public_clarification_at
      AND NEW.public_clarification IS OLD.public_clarification;
END;

-- DELETE IS A WRITE. Without this, every rule above is advisory: delete the
-- row and insert it again, and the correction is gone with no trace anywhere —
-- `public_publications` keeps a digest of the rendered page, not its words.
CREATE TRIGGER public_experiment_is_not_deleted
BEFORE DELETE ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:a_published_record_is_not_deleted')
    WHERE OLD.public_clarification IS NOT NULL
       OR EXISTS (SELECT 1 FROM public_publications p
                   WHERE p.experiment_id = OLD.experiment_id AND p.superseded_at IS NULL);
END;

-- AND A CLARIFICATION MAY NOT ARRIVE ON A NEW ROW. The insert guard already
-- refuses a row that arrives concluded; a row arriving already corrected is the
-- same laundering by a different column.
DROP TRIGGER IF EXISTS public_experiment_guard;

CREATE TRIGGER public_experiment_guard
BEFORE INSERT ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id);
  SELECT RAISE(ABORT,'public_experiment:slug_invalid')
    WHERE NEW.slug GLOB '*[^a-z0-9-]*' OR NEW.slug LIKE '-%' OR NEW.slug LIKE '%-' OR length(NEW.slug) < 3 OR length(NEW.slug) > 60;
  SELECT RAISE(ABORT,'public_experiment:number_invalid') WHERE NEW.number < 1;
  SELECT RAISE(ABORT,'public_experiment:copy_incomplete')
    WHERE trim(NEW.public_title) = '' OR trim(NEW.public_summary) = '' OR trim(NEW.public_who) = ''
       OR trim(NEW.public_what) = '' OR trim(NEW.public_limits) = '' OR trim(NEW.public_sources) = ''
       OR trim(NEW.public_selection) = '' OR trim(NEW.public_note) = '';
  SELECT RAISE(ABORT,'public_experiment:cannot_arrive_concluded') WHERE NEW.public_outcome IS NOT NULL OR NEW.graduated_to_url IS NOT NULL;
  SELECT RAISE(ABORT,'public_experiment:cannot_arrive_clarified')
    WHERE NEW.public_clarification IS NOT NULL OR NEW.public_clarification_at IS NOT NULL;
  SELECT RAISE(ABORT,'public_experiment:supersedes_unknown') WHERE NEW.supersedes_experiment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.supersedes_experiment_id AND e.founder_id = NEW.founder_id);
END;
