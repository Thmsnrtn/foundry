-- Operating is explicitly unproven.  Until a future migration introduces an
-- independently evidenced, owner-authenticated promotion contract, no caller
-- string or successful assisted action may advance a responsibility into it.
CREATE TRIGGER responsibility_operating_promotion_freeze
BEFORE INSERT ON responsibility_transitions WHEN NEW.to_state='operating'
BEGIN
  SELECT RAISE(ABORT,'responsibility_operating:not_earned');
END;
