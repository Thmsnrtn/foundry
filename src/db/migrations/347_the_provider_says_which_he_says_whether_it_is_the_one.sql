-- =============================================================================
-- THE PROVIDER SAYS WHICH ACCOUNT. HE SAYS WHETHER IT IS THE ONE HE MEANT.
--
-- Migration 346 gave a connection the account the provider reports. The owner,
-- 22 September: "The first successful Etsy read can establish which account the
-- authorization actually reaches. It cannot, by itself, establish that this is
-- the shop I intended to connect."
--
-- That is exactly right, and it is a different fact with a different author.
-- Etsy can tell us, truthfully, that a grant opens shop 12345678. Only he can
-- tell us that 12345678 is his. A wrong shop connected by accident — a second
-- Etsy account, a shop a collaborator administers, a mis-click on a consent
-- screen — produces a connection that is technically perfect and operationally
-- wrong, and nothing in the provider's answer can detect it.
--
-- WHY NOT SIMPLY CHECK FOR 'ApexMicro'. Because he forbade it, and he was
-- right: "Do not hard-code ApexMicro as the expected provider identity." A
-- constant in the source is a claim about the world that no evidence supports
-- and that nothing updates when the world moves. The provider reports a name;
-- he recognises it; the recognition is the record.
--
-- FIVE FACTS, AND THIS IS THE THIRD.
--
--   1. Etsy granted technical access        `sense_credentials`
--   2. Etsy says which account it reaches   `identity_verified_at` (346)
--   3. HE SAYS IT IS THE ONE HE MEANT       here
--   4. Foundry has actually done the read   `capability_providers.maturity`
--   5. His authority permits the act        the charter, `capability_access`
--
-- Confirmation is ADDITIVE. It does not erase or redefine (1): the historical
-- fact that Etsy granted access on a date stays exactly what it was, which is
-- what anyone reconstructing an incident will need. And it does not stand in
-- for (4) or (5) — a shop he has confirmed is still a shop nothing has read,
-- and reading it is still not permission to act in it.
--
-- RECOVERY, WITHOUT A SECOND SUBSYSTEM. An incorrect connection must not become
-- a permanent state. It does not: `idx_company_sense_one_live` is unique only
-- `WHERE disconnected_at IS NULL`, so disconnecting — which tells the provider
-- first and reports whether the revocation was confirmed — frees the slot, and
-- reconnecting writes a NEW row with its own identity. The wrong row keeps its
-- identity as history rather than being overwritten. That is the governed path
-- and it already existed; nothing here adds another.
-- =============================================================================

ALTER TABLE company_senses ADD COLUMN identity_confirmed_at TEXT;
ALTER TABLE company_senses ADD COLUMN identity_confirmed_by TEXT;

-- HE CANNOT CONFIRM WHAT THE PROVIDER HAS NOT NAMED.
--
-- Confirmation is a statement about a specific account: "the shop you told me
-- this opens is mine". Without `identity_verified_at` there is no account to be
-- talking about, and a confirmation recorded then would be an approval of
-- whatever the connection later turned out to reach — which is the silent
-- acceptance of an unexpected account that this whole mechanism exists to
-- prevent.
CREATE TRIGGER company_sense_confirmation_follows_the_provider
BEFORE UPDATE OF identity_confirmed_at, identity_confirmed_by ON company_senses
BEGIN
  SELECT RAISE(ABORT,'company_sense_confirmation:nothing_to_confirm')
    WHERE NEW.identity_confirmed_at IS NOT NULL
      AND (NEW.identity_verified_at IS NULL OR NEW.provider_account_ref IS NULL);

  SELECT RAISE(ABORT,'company_sense_confirmation:needs_a_confirmer')
    WHERE NEW.identity_confirmed_at IS NOT NULL
      AND (NEW.identity_confirmed_by IS NULL OR trim(NEW.identity_confirmed_by) = '');

  -- A CONFIRMATION IS NOT WITHDRAWN BY EDITING IT AWAY. Changing his mind about
  -- a connection is disconnecting it, which is a governed act with its own
  -- revocation and its own record. Blanking this column would leave a live
  -- credential reaching a shop he has decided is not his, with nothing saying
  -- so — the quietest possible version of the failure.
  SELECT RAISE(ABORT,'company_sense_confirmation:disconnect_instead')
    WHERE OLD.identity_confirmed_at IS NOT NULL
      AND NEW.identity_confirmed_at IS NULL
      AND NEW.disconnected_at IS NULL;
END;
