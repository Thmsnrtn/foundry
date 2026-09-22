-- =============================================================================
-- A CONNECTION SAYS WHOSE IT IS, AND WHEN THE PROVIDER LAST CONFIRMED IT.
--
-- `company_senses` has recorded, since migration 226, that a connection exists,
-- what the owner was shown when he agreed, when something was last observed
-- through it, and what went wrong last. It has never recorded WHICH ACCOUNT the
-- connection opens.
--
-- That gap is not cosmetic. The owner's directive of 22 September asks that a
-- connection "identify the actual external account, shop, workspace, repository
-- ... based on actual provider evidence wherever possible", and specifically
-- that the Etsy connection name the verified ApexMicro seller shop "rather than
-- relying on a hard-coded shop name". Without a column, the only place that
-- fact could live is inside `sense_credentials.secret_json` — which means a
-- page that wanted to print the shop's name would have to decrypt a live
-- credential to render a list. A surface that reads a secret in order to draw a
-- label is a credential-access path wearing a label's clothes, and it would be
-- reached by every render.
--
-- So the identity is captured once, from the provider's own answer, at the
-- moment the connection is made, and kept in plaintext. It is not a secret: a
-- shop id and a shop name are what the shop publishes to the world.
--
-- WHY `identity_verified_at` IS NOT `last_observed_at`.
--
-- They are two different facts and the directive requires them apart:
-- "Distinguish a successful authentication check from a successful orders read,
-- financial reconciliation, publication verification, or customer-obligation
-- observation."
--
--   `identity_verified_at` — the provider answered the question "who is this?"
--     with this credential. An authentication check. It proves the grant is
--     live; it proves nothing about whether anything useful can be read.
--
--   `last_observed_at`     — a real reading of the thing the connection exists
--     for actually completed. That is the one that licenses a claim about the
--     world, and it is written by the readers, not by a probe.
--
-- A connection with an `identity_verified_at` and no `last_observed_at` has
-- been authorised and never exercised. The directive says such a connection
-- "must not be presented as a fully operational connection", and keeping the
-- two timestamps apart is what makes that sentence checkable rather than
-- aspirational.
-- =============================================================================

ALTER TABLE company_senses ADD COLUMN provider_account_ref TEXT;
ALTER TABLE company_senses ADD COLUMN provider_account_label TEXT;
ALTER TABLE company_senses ADD COLUMN identity_verified_at TEXT;

-- AN IDENTITY IS THE PROVIDER'S ANSWER OR IT IS NOTHING.
--
-- The three columns move together. A label without the moment it was confirmed
-- is a name somebody typed; a confirmation time without a reference is a claim
-- that something was verified with no record of what. Either both halves and a
-- time, or none of them.
--
-- The ref is required whenever a time is set, and the label is not: a provider
-- may legitimately identify an account it has no display name for. The Etsy
-- adapter's own probe says so — "the account answers, and has no shop".
CREATE TRIGGER company_sense_identity_is_whole_or_absent
BEFORE UPDATE OF provider_account_ref, provider_account_label, identity_verified_at
ON company_senses
BEGIN
  SELECT RAISE(ABORT,'company_sense_identity:verified_needs_a_reference')
    WHERE NEW.identity_verified_at IS NOT NULL
      AND (NEW.provider_account_ref IS NULL OR trim(NEW.provider_account_ref) = '');

  SELECT RAISE(ABORT,'company_sense_identity:a_reference_needs_a_time')
    WHERE NEW.provider_account_ref IS NOT NULL
      AND NEW.identity_verified_at IS NULL;

  -- AN IDENTITY IS NOT RE-POINTED IN PLACE. If the provider starts answering
  -- with a different account, that is not an edit to this connection — it is a
  -- different connection, and the owner is owed the disconnect-and-reconnect
  -- rather than a row that quietly changes what it was about. A rename is fine;
  -- the adapter's own comment already says a rename is a fact, not a failure.
  SELECT RAISE(ABORT,'company_sense_identity:immutable_once_set')
    WHERE OLD.provider_account_ref IS NOT NULL
      AND NEW.provider_account_ref IS NOT NULL
      AND NEW.provider_account_ref <> OLD.provider_account_ref;
END;
