-- A STATED POPULATION IS A PROMISE ABOUT WHO IS WRITTEN TO.
--
-- A probe design names the population it is testing. Until now that name was
-- prose in a sealed record and nothing enforced it: the hand would write to any
-- business the owner approved, whether or not that business belonged to the
-- population the design claimed. So the narrowing recorded against Proof 1 —
-- "shops with observed public-bid activity in the COMMBUYS record" — was a
-- sentence, not a constraint, and "approve remaining" could admit every
-- unscreened name in one gesture.
--
-- The rule is general and unconditional, because it should be true of every
-- experiment and not only this one: FOUNDRY MAY NOT WRITE TO A STRANGER
-- WITHOUT A RECORDED, SOURCED REASON THAT STRANGER BELONGS TO THE POPULATION
-- THE DESIGN NAMED. Qualification is an observation Foundry records and can be
-- read back, not a default and not the owner's opinion. Approval stays exactly
-- where it was — the owner's act alone — and this sits underneath it: he
-- decides whom to write to, from a cohort that has already been screened and
-- whose screening he can inspect.
ALTER TABLE experiment_recipients ADD COLUMN qualified_at TEXT;
ALTER TABLE experiment_recipients ADD COLUMN qualified_because TEXT;
ALTER TABLE experiment_recipients ADD COLUMN qualified_source TEXT;

DROP TRIGGER experiment_recipient_guard;
CREATE TRIGGER experiment_recipient_guard
BEFORE INSERT ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id
      AND e.ran_at IS NULL AND e.validity = 'valid');
  SELECT RAISE(ABORT,'experiment_recipient:counterparty_required') WHERE trim(NEW.counterparty_ref) = '';
  SELECT RAISE(ABORT,'experiment_recipient:email_invalid') WHERE NEW.channel = 'email'
    AND (NEW.email IS NULL OR instr(NEW.email, '@') < 2 OR instr(NEW.email, ' ') > 0);
  -- A recipient is never born approved: approval is the owner's act.
  SELECT RAISE(ABORT,'experiment_recipient:review_not_owner_act') WHERE NEW.review_status <> 'pending'
    OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL;
  -- Nor born qualified. Belonging to the population is something observed and
  -- recorded afterwards, never a property a row can assert about itself at the
  -- moment it is written.
  SELECT RAISE(ABORT,'experiment_recipient:qualification_not_a_default') WHERE
    NEW.qualified_at IS NOT NULL OR NEW.qualified_because IS NOT NULL OR NEW.qualified_source IS NOT NULL;
END;

DROP TRIGGER experiment_recipient_review_guard;
CREATE TRIGGER experiment_recipient_review_guard
BEFORE UPDATE ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:immutable') WHERE
    NEW.experiment_id <> OLD.experiment_id OR NEW.founder_id <> OLD.founder_id
    OR NEW.counterparty_ref <> OLD.counterparty_ref OR NEW.created_at <> OLD.created_at
    OR (NEW.channel <> OLD.channel AND NOT (OLD.channel = 'web_form' AND NEW.channel = 'email'))
    OR coalesce(NEW.source_url, '') <> coalesce(OLD.source_url, '');
  -- Only the founder who owns the experiment reviews, and every review names him.
  SELECT RAISE(ABORT,'experiment_recipient:reviewer_invalid') WHERE
    (NEW.review_status <> OLD.review_status OR coalesce(NEW.email, '') <> coalesce(OLD.email, ''))
    AND NEW.reviewed_by IS NOT 'founder:' || OLD.founder_id;
  SELECT RAISE(ABORT,'experiment_recipient:review_stamp_required') WHERE
    NEW.review_status <> OLD.review_status AND NEW.reviewed_at IS NULL;
  SELECT RAISE(ABORT,'experiment_recipient:strike_reason_required') WHERE
    NEW.review_status = 'struck' AND OLD.review_status <> 'struck' AND trim(coalesce(NEW.review_reason, '')) = '';
  SELECT RAISE(ABORT,'experiment_recipient:email_invalid') WHERE NEW.channel = 'email'
    AND (NEW.email IS NULL OR instr(NEW.email, '@') < 2 OR instr(NEW.email, ' ') > 0);
  SELECT RAISE(ABORT,'experiment_recipient:experiment_settled') WHERE EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND (e.ran_at IS NOT NULL OR e.validity <> 'valid'));
  -- A qualification is a record of what was observed, so it needs grounds and
  -- the record they were read from, in the same statement that stamps it.
  SELECT RAISE(ABORT,'experiment_recipient:qualification_needs_grounds') WHERE
    NEW.qualified_at IS NOT NULL AND OLD.qualified_at IS NULL
    AND (trim(coalesce(NEW.qualified_because, '')) = '' OR trim(coalesce(NEW.qualified_source, '')) = '');
  -- And once written it stands. A screening that could be quietly withdrawn or
  -- rewritten after the owner read it is not a screening he can rely on.
  SELECT RAISE(ABORT,'experiment_recipient:qualification_stands') WHERE OLD.qualified_at IS NOT NULL
    AND (NEW.qualified_at IS NOT OLD.qualified_at
      OR NEW.qualified_because IS NOT OLD.qualified_because
      OR NEW.qualified_source IS NOT OLD.qualified_source);
END;
