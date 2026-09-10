-- THE WORKSHOP'S POST DOES NOT GO TO A PRIVATE MAILBOX BY DEFAULT.
--
-- `standUpTheEars` read `founders.email` and made it the address the edge
-- program forwards every message to. That address is the owner's ACCOUNT
-- identity — how he signs in and how Foundry reaches him about his own
-- institution — and using it as the Workshop's mail destination quietly turned
-- a private mailbox into Apex Micro infrastructure. Nobody decided that; it was
-- the default in a line of code.
--
-- The two identities are different things and the schema should say so:
--
--   founders.email              who the owner is to Foundry
--   public_workshop.mail_forward_to   where Apex Micro's post is delivered
--
-- Absent, the Workshop cannot be given ears at all — the door refuses rather
-- than falling back to whatever address happens to be on the founder row. A
-- forwarding destination is a decision, not an inference.
ALTER TABLE public_workshop ADD COLUMN mail_forward_to TEXT;

DROP TRIGGER IF EXISTS public_workshop_forward_guard;
CREATE TRIGGER public_workshop_forward_guard
BEFORE UPDATE ON public_workshop
BEGIN
  -- It must look like an address, and it must not be the workshop's own —
  -- forwarding a workshop's post to itself is a loop, not a destination.
  SELECT RAISE(ABORT,'public_workshop:forward_address_invalid')
    WHERE NEW.mail_forward_to IS NOT NULL
      AND (instr(NEW.mail_forward_to, '@') < 2 OR instr(NEW.mail_forward_to, ' ') > 0);
  SELECT RAISE(ABORT,'public_workshop:forward_would_loop')
    WHERE NEW.mail_forward_to IS NOT NULL AND lower(NEW.mail_forward_to) = lower(NEW.contact_email);
END;
