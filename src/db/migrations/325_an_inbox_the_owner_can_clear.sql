-- =============================================================================
-- AN INBOX THE OWNER CAN CLEAR.
--
-- `workshop_mail.handling` has five states and every one of them is a JUDGEMENT
-- about the message: Foundry is reading it, we are waiting on them, it needs
-- him, it is resolved, there is nothing to do. There was no way to say the only
-- thing a person says most often about a message they have finished with:
-- "take this off my screen."
--
-- So the working inbox could only ever grow. Marking something handled means
-- asserting it was handled, which is false for most of what accumulates, and
-- the alternative was to leave it in view forever.
--
-- ARCHIVING IS A VIEW STATE, NOT A VERDICT. It says nothing about the message,
-- makes no claim about whether anybody dealt with it, and changes no evidence:
-- the row, its reading, its grounds, what was replied and when are all
-- untouched and still readable. Which is exactly why it is the one state in
-- this family that is REVERSIBLE — every verdict here is immutable on purpose,
-- because a verdict that can be edited is not a record. A view state that could
-- not be undone would make tidying a screen into a decision.
--
-- Clearing the owner's view is not deleting institutional evidence, and this
-- migration is the place that says so in the schema rather than in a comment on
-- a route.
-- =============================================================================

ALTER TABLE workshop_mail ADD COLUMN archived_at TEXT;
ALTER TABLE workshop_mail ADD COLUMN archived_because TEXT;

-- The working set, which is what the Inbox reads: not archived, newest first.
CREATE INDEX idx_workshop_mail_working
  ON workshop_mail(founder_id, received_at DESC)
  WHERE archived_at IS NULL;

-- A MESSAGE CANNOT ARRIVE ALREADY PUT AWAY. The same rule every other state in
-- this schema carries: a row that arrives in its final state has no history,
-- and a writer that could insert one could hide a message from the owner
-- entirely on its way in.
CREATE TRIGGER workshop_mail_cannot_arrive_archived
BEFORE INSERT ON workshop_mail
BEGIN
  SELECT RAISE(ABORT,'workshop_mail:cannot_arrive_archived')
    WHERE NEW.archived_at IS NOT NULL OR NEW.archived_because IS NOT NULL;
END;

-- AND PUTTING IT AWAY SAYS WHY, in one line, like every other act on this
-- surface. "Archived" with no sentence is the beginning of a screen nobody can
-- account for.
CREATE TRIGGER workshop_mail_archive_says_why
BEFORE UPDATE OF archived_at ON workshop_mail
BEGIN
  SELECT RAISE(ABORT,'workshop_mail:archive_needs_a_reason')
    WHERE NEW.archived_at IS NOT NULL AND trim(coalesce(NEW.archived_because,'')) = '';
END;
