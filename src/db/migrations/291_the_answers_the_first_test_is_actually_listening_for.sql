-- THE ANSWERS THE FIRST TEST IS ACTUALLY LISTENING FOR.
--
-- Experiment 001's own deliberation records two readings it must be able to
-- tell apart from silence: a shop that says it already has this covered, and a
-- shop that says the work was or was not worth having. The reading vocabulary
-- could not express either. Both would have arrived as `unknown` — safe, but
-- deaf in exactly the place the experiment is trying to hear.
--
-- Four readings, all evidence-bearing, none answerable without the owner. They
-- are deliberately NOT `may_answer`: recognising what somebody said is a
-- different act from deciding what to say back, and the first probe earns the
-- second only after real correspondence exists to judge it on.
DROP TRIGGER workshop_mail_readings_no_new;
INSERT INTO workshop_mail_readings (reading, what_it_is, may_answer, sort_order) VALUES
  ('not_interested',  'they read it and declined; a decision, not silence', 0, 11),
  ('already_has_one', 'they say an existing process or supplier already covers this', 0, 12),
  ('was_useful',      'they say the work was worth having, whether or not they paid', 0, 13),
  ('was_not_useful',  'they say the work was not worth having, or was wrong', 0, 14);
CREATE TRIGGER workshop_mail_readings_no_new
BEFORE INSERT ON workshop_mail_readings
BEGIN SELECT RAISE(ABORT,'workshop_mail_readings:constitutional'); END;
