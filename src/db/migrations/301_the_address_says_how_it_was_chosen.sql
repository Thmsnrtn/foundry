-- =============================================================================
-- FOUNDRY — the address says how it was chosen
--
-- "Write to info@" is the easy answer and usually the wrong one. A shop that
-- publishes estimating@, bids@ or an invitation-to-bid mailbox has told the
-- world where a commercial approach belongs; writing to the general inbox
-- instead is ignoring an instruction the business took the trouble to give.
--
-- So a recipient carries HOW its address was chosen and WHERE it came from.
-- Three kinds, in descending order of what the business itself said:
--
--   role     a mailbox the business published for this kind of message —
--            estimating@, bids@, itb@, sales@
--   named    a person whose published role makes the message appropriate
--   general  the business's general inbox, because it is the best it publishes
--
-- WHY IT IS WORTH A COLUMN. The difference between a generic and a
-- role-specific route is a fact about the CHANNEL, and the channel is half of
-- what this experiment is testing. Recording it before anything is sent is the
-- only way the answer afterwards means anything: "nobody replied" reads
-- differently when every message went to a general inbox than when half went to
-- an estimator who asks for bids for a living.
-- =============================================================================

ALTER TABLE experiment_recipients ADD COLUMN contact_kind TEXT
  CHECK (contact_kind IN ('role','named','general'));
ALTER TABLE experiment_recipients ADD COLUMN contact_source TEXT;

CREATE TRIGGER experiment_recipient_contact_kind_guard
BEFORE UPDATE OF contact_kind, contact_source ON experiment_recipients
BEGIN
  -- AN ADDRESS WITH A KIND HAS SOMEWHERE IT CAME FROM. A classification with
  -- no source is an opinion, and this column exists to hold a fact.
  SELECT RAISE(ABORT,'experiment_recipient:contact_kind_needs_a_source')
    WHERE NEW.contact_kind IS NOT NULL
      AND trim(coalesce(NEW.contact_source,'')) = '';
  -- AND IT IS SETTLED BEFORE ANYBODY IS WRITTEN TO, never revised afterwards
  -- to make a result read better.
  SELECT RAISE(ABORT,'experiment_recipient:contact_kind_stands')
    WHERE OLD.contact_kind IS NOT NULL
      AND (NEW.contact_kind IS NOT OLD.contact_kind
        OR NEW.contact_source IS NOT OLD.contact_source);
END;
