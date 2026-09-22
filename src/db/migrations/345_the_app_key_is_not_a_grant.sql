-- =============================================================================
-- THE APP KEY IS NOT A GRANT, AND IT IS NOT A COMPANY'S EITHER.
--
-- Until now every provider credential in this institution was one of two
-- things. A DEPLOYMENT FACT in an environment variable — `STRIPE_SECRET_KEY`,
-- `CLOUDFLARE_API_TOKEN`, and `ETSY_API_KEY` as it was first written — or a
-- PER-COMPANY grant the owner connected, encrypted into `sense_credentials` or
-- `product_sending_identities`.
--
-- An application key belongs to neither shelf. It identifies THIS DEPLOYMENT to
-- a provider; it grants access to nobody's account, and connecting a shop is
-- still a separate act with its own consent. Filing it under a company would
-- say something false about what it is — that some particular business holds
-- it — and the readers that resolve per-company credentials would find it and
-- be wrong in a way nothing would catch.
--
-- The owner chose this shelf over an environment variable, for a reason worth
-- recording: a Fly secret can only be placed from a machine with `flyctl` and
-- the deploy token on it, and he should be able to place a key from a phone.
-- The cost is that this table exists; the benefit is that the institution can
-- ask him for a credential in the place he already answers questions.
--
-- IT CANNOT ARRIVE UNVERIFIED. `verified_at` and `provider_account_ref` are
-- NOT NULL because the only way a row gets here is through a call that asked
-- the provider whether the key works and was answered. The precedent is the
-- sending identity, which verifies a domain with Resend before it will store a
-- key; the rule it encodes is that "the owner typed something" and "the
-- provider accepts it" are different facts and the second is the one worth
-- keeping.
--
-- AND IT CANNOT ARRIVE IN PLAINTEXT. `encrypt` returns `iv:ciphertext:authTag`,
-- all hex. A value with no colons in it is a secret somebody stored raw, and
-- the guard below refuses it rather than trusting every future writer to
-- remember. A CHECK cannot verify the ciphertext is real; it can make the
-- obvious mistake impossible, which is most of the value.
-- =============================================================================

CREATE TABLE app_credentials (
  provider             TEXT PRIMARY KEY,
  -- Encrypted. For Etsy: {"keystring": "...", "sharedSecret": "..."} — two
  -- values rather than one pre-joined string, because `x-api-key` wants them
  -- joined by a colon and `client_id` wants the keystring alone, and a stored
  -- form that has to be split to be used is a parsing bug waiting for a key
  -- with a colon in it.
  secret_json          TEXT NOT NULL,
  -- What the provider said this key IS, read back at verification. Etsy returns
  -- an `application_id`; recording it means a key swapped for a different app's
  -- is a fact this institution notices rather than a surprise later.
  provider_account_ref TEXT NOT NULL,
  -- When the provider last confirmed it. Not when it was typed.
  verified_at          TEXT NOT NULL,
  set_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Who placed it. A credential with no author is one nobody can ask about.
  set_by               TEXT NOT NULL,
  forgotten_at         TEXT,
  forget_reason        TEXT
);

CREATE TRIGGER app_credential_guard
BEFORE INSERT ON app_credentials
BEGIN
  SELECT RAISE(ABORT,'app_credential:incomplete')
    WHERE trim(NEW.secret_json) = '' OR trim(NEW.set_by) = ''
       OR trim(NEW.provider_account_ref) = '' OR trim(NEW.verified_at) = '';
  -- `iv:ciphertext:authTag`. Three hex parts, two colons.
  SELECT RAISE(ABORT,'app_credential:must_be_encrypted')
    WHERE NEW.secret_json NOT GLOB '*:*:*';
  SELECT RAISE(ABORT,'app_credential:cannot_arrive_forgotten')
    WHERE NEW.forgotten_at IS NOT NULL;
END;

CREATE TRIGGER app_credential_forgetting_is_said_out_loud
BEFORE UPDATE ON app_credentials
BEGIN
  SELECT RAISE(ABORT,'app_credential:forget_needs_reason')
    WHERE NEW.forgotten_at IS NOT NULL AND trim(coalesce(NEW.forget_reason,'')) = '';
  -- The provider a row is for never changes. A key replaced for the same
  -- provider is the same row rewritten; a key for a different provider is a
  -- different row.
  SELECT RAISE(ABORT,'app_credential:provider_is_immutable')
    WHERE NEW.provider <> OLD.provider;
  SELECT RAISE(ABORT,'app_credential:must_be_encrypted')
    WHERE NEW.secret_json NOT GLOB '*:*:*';
END;
