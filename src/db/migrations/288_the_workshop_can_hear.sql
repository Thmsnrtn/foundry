-- =============================================================================
-- THE WORKSHOP CAN HEAR.
--
-- Apex Micro can write to people and cannot hear them answer. Mail to
-- thomas@apexmicro.ai is forwarded to a personal mailbox and never reaches the
-- institution, so a reply saying "stop writing to me", "I paid and got
-- nothing", or "I would pay for this monthly" is invisible to every mechanism
-- built to honour it. The Workshop has a mouth and no ears.
--
-- WHAT THIS IS NOT. It is not a second inbound store. Migration 131 already
-- established provider-neutral inbound customer communication, deduplicated by
-- external id, and stated the invariant this needs — a message is evidence
-- that someone outside said something; it is not authority, not consent, not
-- proof they are right. Migration 132 already refused to add a proposal table.
-- That spine stays. This adds only what mail itself carries and the Workshop
-- itself needs: the envelope, the thread, and who the sender is to us.
--
-- WHY NOT THAT TABLE, THEN. It is bound to a PRODUCT'S SUPPORT CHANNEL, which
-- is governed by a customer_support responsibility. Apex Micro has no
-- customers and no support channel; it has public correspondence about
-- experiments. Routing the Workshop through that model would mean inventing a
-- customer-support responsibility for a company with zero customers — modelling
-- a reality that has not happened, which is the failure this whole direction
-- warns against.
--
-- So this stands alone, and says out loud where it should stop standing alone:
-- when Apex Micro has customers with support obligations, `support_message_id`
-- is where a Workshop message becomes a support message too, and the envelope
-- below becomes the mail-shaped half of one record rather than a whole one.
-- Recorded as a named convergence, not left as an accident to rediscover.
-- =============================================================================

-- ─── The envelope, kept as it arrived ────────────────────────────────────────
CREATE TABLE workshop_mail (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  -- The convergence point named above. Null until this Workshop has a support
  -- channel that this message also belongs to.
  support_message_id TEXT REFERENCES inbound_customer_messages(id),
  subject         TEXT,
  -- WHAT THEY WROTE. Text only, and not because HTML is hard: a stored blob of
  -- someone else's markup is a rendering hazard on the owner's own screen, and
  -- the bytes are kept whole in `raw_ref` for anyone who needs to check.
  body            TEXT NOT NULL,
  -- THE PROVIDER'S OWN IDENTITY FOR THIS MESSAGE, and the headers that make a
  -- conversation a conversation. Subject matching is not threading: subjects
  -- are edited, translated, and reused by unrelated people.
  rfc_message_id  TEXT NOT NULL,
  in_reply_to     TEXT,
  references_hdr  TEXT,
  thread_key      TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  from_name       TEXT,
  to_email        TEXT NOT NULL,
  -- WHAT THE TRANSPORT SAID ABOUT THE SENDER'S CLAIM TO BE THE SENDER. Kept
  -- verbatim, because "the address said so" is not authentication and the
  -- difference matters the moment somebody asks for money or data.
  spf             TEXT,
  dkim            TEXT,
  dmarc           TEXT,
  -- HOW BIG IT WAS AT THE EDGE, as the program that received it reported.
  -- Provenance the owner can check a rendering against. There is deliberately
  -- no pointer to a stored copy of the raw bytes: nothing stores them yet, and
  -- a column promising a copy that does not exist is worse than no column.
  raw_bytes       INTEGER,
  -- Who this is to us, resolved from rows and never from prose.
  contact_email   TEXT,
  experiment_id   TEXT REFERENCES venture_experiments(id),
  -- What the institution made of it. `unknown` is a legitimate resting state:
  -- a message nobody understood is safer than a message confidently miscast.
  reading         TEXT NOT NULL DEFAULT 'unknown',
  reading_because TEXT,
  -- Handling, for the owner's eye. Deliberately few: anything finer would be a
  -- workflow product nobody asked for.
  handling        TEXT NOT NULL DEFAULT 'foundry_reading'
                    CHECK (handling IN ('foundry_reading','waiting_on_them','needs_owner','resolved','no_action')),
  handled_because TEXT,
  -- The sender's clock, kept apart from ours: a delayed message is late, not
  -- recent, and conflating them makes evidence ordering a lie (migration 217).
  sent_at         TEXT,
  received_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_workshop_mail_rfc ON workshop_mail(founder_id, rfc_message_id);
CREATE INDEX idx_workshop_mail_thread ON workshop_mail(founder_id, thread_key, received_at);
CREATE INDEX idx_workshop_mail_handling ON workshop_mail(founder_id, handling);

CREATE TRIGGER workshop_mail_guard
BEFORE INSERT ON workshop_mail
BEGIN
  SELECT RAISE(ABORT,'workshop_mail:incomplete')
    WHERE trim(NEW.rfc_message_id) = '' OR trim(NEW.from_email) = ''
       OR trim(NEW.to_email) = '' OR trim(NEW.thread_key) = '';
  SELECT RAISE(ABORT,'workshop_mail:observed_in_the_future')
    WHERE NEW.sent_at IS NOT NULL AND datetime(NEW.sent_at) > datetime('now', '+15 minutes');
  -- IT ARRIVES UNREAD AND UNJUDGED. A message that could be inserted already
  -- classified and already resolved would let whatever wrote the row decide
  -- what the world said, which is the one thing this table exists to prevent.
  SELECT RAISE(ABORT,'workshop_mail:cannot_arrive_handled')
    WHERE NEW.handling <> 'foundry_reading' OR NEW.reading <> 'unknown';
  SELECT RAISE(ABORT,'workshop_mail:not_the_workshops')
    WHERE NOT EXISTS (SELECT 1 FROM public_workshop w
      WHERE w.founder_id = NEW.founder_id AND lower(NEW.to_email) LIKE '%@' || w.zone_name);
END;

CREATE TRIGGER workshop_mail_immutable
BEFORE UPDATE ON workshop_mail
BEGIN
  -- WHAT ARRIVED IS NOT EDITABLE. Only the institution's reading of it is.
  SELECT RAISE(ABORT,'workshop_mail:envelope_immutable')
    WHERE NEW.rfc_message_id IS NOT OLD.rfc_message_id OR NEW.from_email IS NOT OLD.from_email
       OR NEW.to_email IS NOT OLD.to_email OR NEW.raw_bytes IS NOT OLD.raw_bytes
       OR NEW.spf IS NOT OLD.spf OR NEW.dkim IS NOT OLD.dkim OR NEW.dmarc IS NOT OLD.dmarc
       OR NEW.received_at IS NOT OLD.received_at OR NEW.founder_id IS NOT OLD.founder_id;
  SELECT RAISE(ABORT,'workshop_mail:reading_needs_grounds')
    WHERE NEW.reading IS NOT OLD.reading AND trim(coalesce(NEW.reading_because,'')) = '';
END;

CREATE TRIGGER workshop_mail_erasable
BEFORE DELETE ON workshop_mail
BEGIN
  SELECT RAISE(ABORT,'workshop_mail:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

-- ─── What a message may be taken to mean ─────────────────────────────────────
-- A closed vocabulary, small on purpose. Classification exists to route
-- responsibility and authority; it is not an ontology of human intent, and a
-- longer list would be a claim to read minds that the evidence cannot support.
CREATE TABLE workshop_mail_readings (
  reading    TEXT PRIMARY KEY,
  what_it_is TEXT NOT NULL,
  -- What the institution is allowed to do about it without asking. The point
  -- of the column: autonomy is a property of the KIND of message, decided in
  -- advance, not a property of how confident something felt at the time.
  may_answer INTEGER NOT NULL CHECK (may_answer IN (0,1)),
  sort_order INTEGER NOT NULL
);
INSERT INTO workshop_mail_readings (reading, what_it_is, may_answer, sort_order) VALUES
  ('unknown',         'nobody has established what this is', 0, 1),
  ('stop_writing',    'they asked not to be contacted again', 1, 2),
  ('wants_more',      'they asked for something further, within a stated scope', 0, 3),
  ('answering_offer', 'a reply to an offer the Workshop made', 0, 4),
  ('asking',          'a question about the work, the offer or the workshop', 0, 5),
  ('owed_something',  'they say something promised has not arrived or is wrong', 0, 6),
  ('wants_money_back','they are asking for a refund or a remedy', 0, 7),
  ('complaint',       'they object to having been written to, or to the work', 0, 8),
  ('not_for_us',      'automated mail, bounces, or messages meant for nobody here', 1, 9),
  ('needs_a_person',  'legal, security, press, or anything consequential enough to be his', 0, 10);

CREATE TRIGGER workshop_mail_readings_constitutional
BEFORE DELETE ON workshop_mail_readings
BEGIN SELECT RAISE(ABORT,'workshop_mail_readings:constitutional'); END;
CREATE TRIGGER workshop_mail_readings_no_new
BEFORE INSERT ON workshop_mail_readings
BEGIN SELECT RAISE(ABORT,'workshop_mail_readings:constitutional'); END;
CREATE TRIGGER workshop_mail_readings_fixed
BEFORE UPDATE ON workshop_mail_readings
BEGIN
  SELECT RAISE(ABORT,'workshop_mail_readings:constitutional')
    WHERE NEW.reading IS NOT OLD.reading OR NEW.what_it_is IS NOT OLD.what_it_is
       OR NEW.sort_order IS NOT OLD.sort_order;
END;

-- The reading must be one the institution has a word for.
CREATE TRIGGER workshop_mail_reading_known
BEFORE UPDATE ON workshop_mail
BEGIN
  SELECT RAISE(ABORT,'workshop_mail:unknown_reading') WHERE NOT EXISTS (
    SELECT 1 FROM workshop_mail_readings k WHERE k.reading = NEW.reading);
END;

-- ─── The door mail comes through ─────────────────────────────────────────────
-- One secret, held by the program at the edge, so the intake answers only the
-- Workshop's own Worker. Rotatable without touching anything else.
CREATE TABLE workshop_mail_intake (
  founder_id  TEXT PRIMARY KEY REFERENCES founders(id),
  intake_key  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at  TEXT,
  last_seen_at TEXT
);
CREATE TRIGGER workshop_mail_intake_guard
BEFORE INSERT ON workshop_mail_intake
BEGIN
  SELECT RAISE(ABORT,'workshop_mail_intake:key_too_weak') WHERE length(NEW.intake_key) < 32;
END;
