-- Migration 131: provider-neutral inbound customer communication.
--
-- Audit before adding anything. What already existed, and why none of it fits:
--
--   • `conversation_threads` / `conversation_messages` — the founder talking to
--     Foundry. Not customer communication.
--   • `customers` / `customer_events` — a customer-intelligence projection with
--     no tenant guards, no external identity contract, and no provenance. It is
--     a directory, not an evidence path.
--   • `/webhooks/stripe`, `/webhooks/transcripts/*`, `/webhooks/voice-reply` —
--     all vendor-specific, none carrying customer support communication.
--   • `POST /ingest/:token` — the right AUTHENTICATION and tenancy primitive,
--     the wrong store. Its body schema is metric-shaped and unknown keys fall
--     into `custom_metrics`. Putting messages there would poison a numeric
--     store to avoid writing a table.
--
-- So: reuse the token-authenticated tenant-bound intake pattern, keep the
-- semantic store clean, and stay provider-neutral. No vendor name appears in
-- this schema. An adapter for any provider is an ordinary caller.
--
-- WHAT A CUSTOMER MESSAGE IS: evidence that someone outside the company said
-- something. It is not a responsibility, not authority, not consent, not proof
-- the customer is correct, and not proof that anything was resolved.

-- ─── 1. A support channel ────────────────────────────────────────────────────
-- A named way customers reach this company, bound to the responsibility that
-- governs it. The binding is the grounded association: a message is attributed
-- to a responsibility because it arrived on that responsibility's own channel,
-- never because prose about it looked relevant.
--
-- The intake key is what establishes channel identity. A caller cannot label
-- itself as a channel — it authenticates as one — which is why the payload has
-- no channel field for anyone to forge.
CREATE TABLE support_channels (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products(id),
  responsibility_id TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  label             TEXT NOT NULL,
  intake_key        TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at        TEXT
);
CREATE INDEX idx_support_channels_product ON support_channels(product_id,responsibility_id);

CREATE TRIGGER support_channel_guard
BEFORE INSERT ON support_channels
BEGIN
  SELECT RAISE(ABORT,'support_channel:responsibility_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id
      AND r.capability='customer_support' AND r.disposition='active');

  SELECT RAISE(ABORT,'support_channel:label_required')
  WHERE NEW.label IS NULL OR trim(NEW.label)='';

  -- A guessable key is not authentication.
  SELECT RAISE(ABORT,'support_channel:key_too_weak')
  WHERE NEW.intake_key IS NULL OR length(NEW.intake_key)<24;
END;

-- ─── 2. The message itself ───────────────────────────────────────────────────
-- The minimum the support capability actually consumes: who it is from, what
-- they said, when they said it, and a stable external identity so the same
-- provider event delivered twice is the same message.
--
-- Deliberately absent: attachments, read state, agent assignment, priority,
-- SLA, tags. None has a consumer. No speculative omnichannel platform.
CREATE TABLE inbound_customer_messages (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id),
  channel_id          TEXT NOT NULL REFERENCES support_channels(id),
  responsibility_id   TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  external_message_id TEXT NOT NULL,
  conversation_ref    TEXT,
  contact_email       TEXT NOT NULL,
  subject             TEXT,
  body                TEXT NOT NULL,
  -- The source's own clock, kept apart from ours. A delayed delivery is late,
  -- not recent, and conflating the two would make evidence ordering a lie.
  source_observed_at  TEXT NOT NULL,
  received_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_signal_id  TEXT NOT NULL REFERENCES signal_events(id)
);

-- Replay convergence. The same provider event, redelivered any number of times,
-- is one message. Scoped per tenant, so two companies may legitimately hold the
-- same provider id without colliding — and neither can see the other's.
CREATE UNIQUE INDEX idx_inbound_message_identity
  ON inbound_customer_messages(product_id,channel_id,external_message_id);

CREATE TRIGGER inbound_customer_message_guard
BEFORE INSERT ON inbound_customer_messages
BEGIN
  -- The channel must be this company's, live, and bound to the responsibility
  -- the message is being attributed to. Attribution is structural.
  SELECT RAISE(ABORT,'inbound_message:channel_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM support_channels c
    WHERE c.id=NEW.channel_id AND c.product_id=NEW.product_id
      AND c.responsibility_id=NEW.responsibility_id AND c.revoked_at IS NULL);

  SELECT RAISE(ABORT,'inbound_message:identity_required') WHERE
    NEW.external_message_id IS NULL OR trim(NEW.external_message_id)=''
    OR NEW.contact_email IS NULL OR instr(NEW.contact_email,'@')=0;

  SELECT RAISE(ABORT,'inbound_message:content_required')
  WHERE NEW.body IS NULL OR trim(NEW.body)='' OR length(NEW.body)>8192;

  SELECT RAISE(ABORT,'inbound_message:subject_too_long')
  WHERE NEW.subject IS NOT NULL AND length(NEW.subject)>512;

  -- The evidence row must be this company's own customer-message observation.
  SELECT RAISE(ABORT,'inbound_message:evidence_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE e.id=NEW.evidence_signal_id AND e.product_id=NEW.product_id
      AND e.source='customer_message_ingest');
END;

-- ─── 3. The evidence row ─────────────────────────────────────────────────────
-- A customer message enters the institution the same way every other external
-- observation does. The independence rules established for `/ingest` apply
-- unchanged: the outside sender reports reality and may not claim what its
-- message proves.
CREATE TRIGGER customer_message_observation_guard
BEFORE INSERT ON signal_events WHEN NEW.source='customer_message_ingest'
BEGIN
  SELECT RAISE(ABORT,'customer_message:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.channel_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.external_message_id'),''))='';

  -- An external sender may not tell Foundry what its message means. Which
  -- expectation it proves, which judgment it settles, which responsibility it
  -- satisfies, and what maturity or authority should follow are institutional
  -- conclusions — never claims a message can carry.
  SELECT RAISE(ABORT,'customer_message:institutional_claim') WHERE
    json_extract(NEW.payload_json,'$.expectation_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.judgment_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.expected_event_type') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.state') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.consent') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.capability') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.authority') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.scope') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.to_mode') IS NOT NULL;

  -- The channel must belong to the company the intake authenticated as. The
  -- same external id under a different tenant is a different message, and
  -- neither can reach the other.
  SELECT RAISE(ABORT,'customer_message:channel_foreign') WHERE NOT EXISTS (
    SELECT 1 FROM support_channels c
    WHERE c.id=json_extract(NEW.payload_json,'$.channel_id')
      AND c.product_id=NEW.product_id AND c.revoked_at IS NULL);
END;
