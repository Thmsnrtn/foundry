-- =============================================================================
-- A RECOGNITION IS ABOUT ONE ACCOUNT, AND THE PROVIDER CAN STOP AGREEING.
--
-- Migration 346 recorded which account a connection reaches. 347 recorded that
-- the owner says it is the one he meant. Both are about a moment. Neither
-- survives the thing that actually goes wrong over years: the provider starts
-- answering with a DIFFERENT account, through the same connection, and nothing
-- notices.
--
-- The owner, 22 September 2026: "If the provider subsequently reports a
-- materially different account identity, or credentials are replaced in a way
-- that changes the effective account being accessed, Foundry must not silently
-- continue operating under the previous recognition."
--
-- WHAT 346 ALREADY DID, AND WHY IT IS NOT ENOUGH.
-- `company_sense_identity:immutable_once_set` refuses to re-point a verified
-- connection at a new account. That is the right refusal and it stays: it means
-- the disagreement can never be laundered into agreement by an UPDATE. But a
-- refusal is not a record. Today the write simply fails, the caller sees an
-- exception, and the connection carries on looking exactly as recognised as it
-- did yesterday while the provider says otherwise.
--
-- So the missing thing is not another rule. It is somewhere to PUT the
-- disagreement, on the row the disagreement is about, where the qualification
-- gate can read it and the Connectors page can say it.
--
-- FIVE DISTINCTIONS, WHICH THIS IS BUILT TO KEEP APART.
--
--   a display name changed on the same account   -> a rename. Not a dispute.
--                                                   `provider_account_label`
--                                                   moves; 346 permits it.
--   the credential was refreshed for the same
--     connection and account                     -> ordinary maintenance.
--                                                   Nothing here changes.
--   a replacement grant                          -> a NEW `company_senses` row
--                                                   with its own null columns.
--                                                   Not a dispute; a new
--                                                   recognition.
--   the provider names a different account       -> THIS. Recorded, not
--                                                   applied.
--   identity could not be retrieved at all       -> NOT this. A provider that
--                                                   did not answer has not
--                                                   said anything, and turning
--                                                   silence into an accusation
--                                                   would make every outage
--                                                   look like a stolen shop.
--
-- STABLE IDENTIFIER, NOT DISPLAY NAME. `provider_account_ref` is Etsy's shop id
-- and its equivalent elsewhere. A shop renamed from Printbls4YouStudio to
-- ApexMicro keeps its id; comparing names would have raised a dispute on the
-- exact event the owner already told us to expect.
--
-- WHY IT MAY BE CLEARED WITHOUT HIM. A dispute is a technical observation, and
-- the owner's rule is that Foundry resolves what it can resolve: "Where a
-- condition can safely be resolved autonomously, Foundry should resolve it
-- autonomously." If the provider goes back to naming the recognised account —
-- a bad response, a routing fault at their end, an account switched back — the
-- disagreement has ended and there is nothing left for him to judge. Clearing
-- it grants nothing: the recognition it was standing in front of was never
-- touched, so what resumes is exactly what he already recognised.
-- =============================================================================

ALTER TABLE company_senses ADD COLUMN identity_disputed_at TEXT;
ALTER TABLE company_senses ADD COLUMN identity_disputed_ref TEXT;
ALTER TABLE company_senses ADD COLUMN identity_disputed_detail TEXT;

-- A DISPUTE IS A DISAGREEMENT WITH SOMETHING, OR IT IS NOT A DISPUTE.
CREATE TRIGGER company_sense_dispute_is_a_disagreement
BEFORE UPDATE OF identity_disputed_at, identity_disputed_ref, identity_disputed_detail
ON company_senses
BEGIN
  -- The two halves move together, as in 346: a time without the account that
  -- was named records that something happened and not what, and a named
  -- account without a time is a claim with no moment behind it.
  SELECT RAISE(ABORT,'company_sense_dispute:needs_both_halves')
    WHERE (NEW.identity_disputed_at IS NULL) <> (NEW.identity_disputed_ref IS NULL);

  -- Nothing to disagree WITH. A connection whose identity was never verified
  -- has made no claim, so a provider naming an account is a recovery rather
  -- than a contradiction, and filing it here would invent a conflict where
  -- there was only an absence.
  SELECT RAISE(ABORT,'company_sense_dispute:nothing_to_disagree_with')
    WHERE NEW.identity_disputed_at IS NOT NULL
      AND (NEW.identity_verified_at IS NULL OR NEW.provider_account_ref IS NULL);

  -- AGREEMENT IS NOT A DISPUTE. Recording one when the provider named the
  -- account we already hold would stop a connection over nothing, and would
  -- make the blocked state unfalsifiable from the evidence stored with it.
  SELECT RAISE(ABORT,'company_sense_dispute:that_is_the_same_account')
    WHERE NEW.identity_disputed_ref IS NOT NULL
      AND NEW.identity_disputed_ref = NEW.provider_account_ref;

  -- The provider's own sentence is the evidence, and a dispute that stops
  -- consequential work owes the owner the words it was based on.
  SELECT RAISE(ABORT,'company_sense_dispute:needs_its_evidence')
    WHERE NEW.identity_disputed_at IS NOT NULL
      AND (NEW.identity_disputed_detail IS NULL OR trim(NEW.identity_disputed_detail) = '');
END;
