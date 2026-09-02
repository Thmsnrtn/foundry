-- =============================================================================
-- A CREDENTIAL THAT BELONGS TO A SENSE
--
-- Migration 226 gave Foundry senses: what it is trying to learn, from whom, and
-- — constitutionally — what learning it never grants. What it could not do is
-- actually hold the key. `company_senses.integration_id` pointed at the old
-- `integrations` table, which is a credential and a cadence with no idea what
-- it is FOR, and reaching it meant the generic integrations screen the owner
-- said must disappear.
--
-- So the credential is a first-class part of the sense, and its whole life is
-- modelled: asked for, granted, stored, refreshed, failing, revoked, gone.
--
-- WHAT THE SCOPES TABLE IS FOR, AND WHY IT IS CONSTITUTIONAL.
--
-- "Minimum required scope" is only a promise until something can refuse to ask
-- for more. `sense_provider_scopes` is the exact list of scopes each
-- (provider, sense, mode) may request, immutable at runtime, and the authorize
-- URL is built from it and nothing else. A caller cannot widen what the owner
-- is asked to grant, because there is no parameter through which to try.
--
-- WHY AN AUTHORIZATION IS A ROW BEFORE IT IS A CREDENTIAL. The owner leaves for
-- the provider and comes back with a code. Between those two moments the
-- request has to be remembered — which company, which sense, which scopes, and
-- a secret nobody else could guess — or the callback is an open door: anyone
-- who can reach it with a plausible code could bind a credential to somebody's
-- company. The row expires on its own and is consumed exactly once.
--
-- AND THE SECRET IS NEVER THE POINT. `secret_json` is encrypted at rest with
-- the same envelope every other credential in this system uses. Nothing reads
-- it except the adapter that must, and nothing surfaces it to the owner ever —
-- what he is shown is what the connection LETS Foundry understand, and what it
-- still does not let it do.
-- =============================================================================

CREATE TABLE sense_provider_scopes (
  provider   TEXT NOT NULL,
  sense_key  TEXT NOT NULL REFERENCES senses(sense_key),
  mode       TEXT NOT NULL CHECK (mode IN ('real','sandbox','reference')),
  scope      TEXT NOT NULL,
  -- What this one scope is for, in the owner's words. Shown when he is asked.
  because    TEXT NOT NULL,
  PRIMARY KEY (provider, sense_key, mode, scope)
);

-- READ-ONLY, EVERY ONE OF THEM. That is not a coincidence to be noticed later:
-- a sense is not a hand, and the scope list is where that stops being a
-- sentence in a document and becomes what the owner is actually asked to grant.
INSERT INTO sense_provider_scopes (provider, sense_key, mode, scope, because) VALUES
  ('stripe', 'revenue', 'real', 'read_only',
   'to read charges, subscriptions and payment failures, and nothing else'),
  ('stripe', 'revenue', 'sandbox', 'read_only',
   'the same, against test data that is not the world'),
  ('stripe', 'customers', 'real', 'read_only',
   'to read customer records and subscription state, and nothing else'),
  ('stripe', 'customers', 'sandbox', 'read_only',
   'the same, against test data that is not the world'),
  ('posthog', 'product_usage', 'real', 'project:read',
   'to read event counts for the project you name'),
  ('posthog', 'customers', 'real', 'project:read',
   'to read how many distinct people used it'),
  ('plausible', 'product_usage', 'real', 'stats:read:*',
   'to read page and visitor counts'),
  ('github', 'software', 'real', 'repo:read',
   'to read the repository, its commits and its pull requests'),
  ('sentry', 'errors', 'real', 'project:read',
   'to read error events and how often they happen'),
  ('linear', 'software', 'real', 'read',
   'to read issues and what is being worked on'),
  ('intercom', 'support', 'real', 'read',
   'to read conversation counts and what customers wrote in about'),
  -- The reference world asks for a scope it does not need, on purpose: the
  -- credential lifecycle is only controlled-proven if the reference provider
  -- travels every step of it, including being asked for a minimum scope.
  ('reference_world', 'revenue', 'reference', 'reference:read',
   'to read a company that does not exist'),
  ('reference_world', 'customers', 'reference', 'reference:read',
   'to read a company that does not exist'),
  ('reference_world', 'product_usage', 'reference', 'reference:read',
   'to read a company that does not exist'),
  ('reference_world', 'support', 'reference', 'reference:read',
   'to read a company that does not exist');

CREATE TRIGGER sense_provider_scopes_constitutional_insert
BEFORE INSERT ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;
CREATE TRIGGER sense_provider_scopes_constitutional_update
BEFORE UPDATE ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;
CREATE TRIGGER sense_provider_scopes_constitutional_delete
BEFORE DELETE ON sense_provider_scopes
BEGIN SELECT RAISE(ABORT,'sense_scope:constitutional'); END;

-- THE REQUEST, REMEMBERED WHILE HE IS AWAY.
CREATE TABLE sense_authorizations (
  state          TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id),
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  sense_key      TEXT NOT NULL REFERENCES senses(sense_key),
  provider       TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('real','sandbox','reference')),
  -- Exactly what was asked for, so the callback can check that exactly that is
  -- what came back.
  scopes_json    TEXT NOT NULL,
  -- What he was shown before he left. Stored so consent is provable against the
  -- words he actually saw rather than the words the page says today.
  disclosure     TEXT NOT NULL,
  started_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     TEXT NOT NULL,
  consumed_at    TEXT
);

CREATE TRIGGER sense_authorization_guard
BEFORE INSERT ON sense_authorizations
BEGIN
  SELECT RAISE(ABORT,'sense_authorization:incomplete')
    WHERE trim(NEW.state) = '' OR length(NEW.state) < 24
       OR trim(NEW.disclosure) = ''
       OR json_valid(NEW.scopes_json) = 0
       OR json_array_length(NEW.scopes_json) = 0;
  SELECT RAISE(ABORT,'sense_authorization:cannot_arrive_consumed')
    WHERE NEW.consumed_at IS NOT NULL;
  SELECT RAISE(ABORT,'sense_authorization:expiry_required')
    WHERE datetime(NEW.expires_at) <= datetime(NEW.started_at);
END;

-- CONSUMED ONCE, EVER. A replayed callback is the attack this stops: the same
-- code arriving twice must not bind a second credential.
CREATE TRIGGER sense_authorization_consumed_once
BEFORE UPDATE ON sense_authorizations
BEGIN
  SELECT RAISE(ABORT,'sense_authorization:already_consumed')
    WHERE OLD.consumed_at IS NOT NULL;
  SELECT RAISE(ABORT,'sense_authorization:immutable')
    WHERE NEW.product_id IS NOT OLD.product_id
       OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.sense_key IS NOT OLD.sense_key
       OR NEW.provider IS NOT OLD.provider
       OR NEW.mode IS NOT OLD.mode
       OR NEW.scopes_json IS NOT OLD.scopes_json
       OR NEW.disclosure IS NOT OLD.disclosure;
END;

-- THE KEY ITSELF.
CREATE TABLE sense_credentials (
  id                 TEXT PRIMARY KEY,
  company_sense_id   TEXT NOT NULL REFERENCES company_senses(id),
  product_id         TEXT NOT NULL REFERENCES products(id),
  provider           TEXT NOT NULL,
  -- What the provider actually granted, which is not always what was asked.
  granted_scopes_json TEXT NOT NULL,
  -- Encrypted at rest with the same envelope as every other credential here.
  secret_json        TEXT NOT NULL,
  -- NULL means it does not expire on a clock; most do.
  expires_at         TEXT,
  obtained_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at       TEXT,
  -- Consecutive failures to refresh or to reach the provider. The company page
  -- reads this: a credential that has failed is a sense that has gone blind,
  -- and the owner should be told before he is shown anything derived from it.
  failures           INTEGER NOT NULL DEFAULT 0,
  last_failure       TEXT,
  revoked_at         TEXT,
  revoke_reason      TEXT,
  -- Whether the provider itself confirmed the revocation. A local delete with
  -- a live token at the other end is not a revocation, and saying it was would
  -- be the most dangerous lie this table could tell.
  revoked_at_provider INTEGER NOT NULL DEFAULT 0
);

-- One live credential per sense. Two keys for one question is two answers.
CREATE UNIQUE INDEX idx_sense_credential_one_live
  ON sense_credentials(company_sense_id) WHERE revoked_at IS NULL;

CREATE TRIGGER sense_credential_guard
BEFORE INSERT ON sense_credentials
BEGIN
  SELECT RAISE(ABORT,'sense_credential:incomplete')
    WHERE trim(NEW.secret_json) = ''
       OR json_valid(NEW.granted_scopes_json) = 0
       OR json_array_length(NEW.granted_scopes_json) = 0;
  SELECT RAISE(ABORT,'sense_credential:cannot_arrive_revoked')
    WHERE NEW.revoked_at IS NOT NULL;
  -- BOUND TO THE COMPANY THE SENSE IS BOUND TO. Without this a credential could
  -- name one company while its sense named another, and every read afterwards
  -- would be right about the wrong business.
  SELECT RAISE(ABORT,'sense_credential:company_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM company_senses s
     WHERE s.id = NEW.company_sense_id AND s.product_id = NEW.product_id
       AND s.provider = NEW.provider AND s.disconnected_at IS NULL);
END;

CREATE TRIGGER sense_credential_revoke_is_one_way
BEFORE UPDATE ON sense_credentials
BEGIN
  SELECT RAISE(ABORT,'sense_credential:already_revoked')
    WHERE OLD.revoked_at IS NOT NULL;
  SELECT RAISE(ABORT,'sense_credential:revoke_needs_reason')
    WHERE NEW.revoked_at IS NOT NULL AND trim(coalesce(NEW.revoke_reason,'')) = '';
  SELECT RAISE(ABORT,'sense_credential:immutable')
    WHERE NEW.company_sense_id IS NOT OLD.company_sense_id
       OR NEW.product_id IS NOT OLD.product_id
       OR NEW.provider IS NOT OLD.provider
       OR NEW.obtained_at IS NOT OLD.obtained_at;
END;

CREATE TRIGGER sense_credential_no_delete
BEFORE DELETE ON sense_credentials
BEGIN
  SELECT RAISE(ABORT,'sense_credential:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE INDEX idx_sense_credentials_live
  ON sense_credentials(product_id, provider) WHERE revoked_at IS NULL;
