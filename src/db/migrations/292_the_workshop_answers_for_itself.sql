-- THE WORKSHOP ANSWERS FOR ITSELF.
--
-- Until now Apex Micro could hear and could not speak. Every message, however
-- ordinary, ended in the owner's queue — which is not autonomy, it is a
-- forwarding address with extra steps. The owner should govern the
-- communication system without being the communication system.
--
-- What makes autonomous answering safe is not the model's good behaviour. It
-- is that the thing which reads hostile text and the thing which holds
-- authority are different things:
--
--   raw untrusted message
--     → an interpreter that is a pure function from text to a structured
--       reading, with no database, no secrets, no tools and no effects
--     → canonical context resolved from OUR rows, never from the message
--     → a judgement made by policy, which is where authority lives
--     → an answer composed only from what the public page already states
--     → the governed effect path, with a receipt
--
-- The sender may make a request. The request never becomes permission. A
-- refund happens because the payment record and the refund policy say so, not
-- because an email asked.
--
-- One reply per inbound message, forever: `mail_id` is unique, so a redelivery,
-- a retry or a restart cannot produce a second answer to something somebody
-- said once.

-- How much of its own correspondence the Workshop may conduct. Constitutional:
-- the three states exist, and only which one is in force may change.
CREATE TABLE workshop_correspondence_modes (
  mode       TEXT PRIMARY KEY,
  what_it_is TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO workshop_correspondence_modes (mode, what_it_is, sort_order) VALUES
  ('off',        'nothing is answered; every message waits for the owner', 1),
  ('draft',      'answers are composed and recorded, and nothing is sent', 2),
  ('autonomous', 'answers inside the envelope are sent without asking; the rest still escalate', 3);
CREATE TRIGGER workshop_correspondence_modes_constitutional
BEFORE DELETE ON workshop_correspondence_modes
BEGIN SELECT RAISE(ABORT,'workshop_correspondence_modes:constitutional'); END;
CREATE TRIGGER workshop_correspondence_modes_no_new
BEFORE INSERT ON workshop_correspondence_modes
BEGIN SELECT RAISE(ABORT,'workshop_correspondence_modes:constitutional'); END;
CREATE TRIGGER workshop_correspondence_modes_fixed
BEFORE UPDATE ON workshop_correspondence_modes
BEGIN SELECT RAISE(ABORT,'workshop_correspondence_modes:constitutional'); END;

-- WHICH MODE IS IN FORCE, AND WHY IT CHANGED. Autonomy is earned and
-- revocable, so every change carries its reason and who made it.
CREATE TABLE workshop_correspondence_policy (
  founder_id TEXT PRIMARY KEY REFERENCES founders(id),
  mode       TEXT NOT NULL REFERENCES workshop_correspondence_modes(mode),
  because    TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER workshop_correspondence_policy_guard
BEFORE INSERT ON workshop_correspondence_policy
BEGIN
  SELECT RAISE(ABORT,'workshop_correspondence_policy:reason_required') WHERE trim(NEW.because) = '';
  -- Only the owner decides how much the Workshop may say for itself. Nothing
  -- that reads a message can widen what messages are answered.
  SELECT RAISE(ABORT,'workshop_correspondence_policy:owner_act') WHERE NEW.changed_by IS NOT 'founder:' || NEW.founder_id;
END;
CREATE TRIGGER workshop_correspondence_policy_change_guard
BEFORE UPDATE ON workshop_correspondence_policy
BEGIN
  SELECT RAISE(ABORT,'workshop_correspondence_policy:reason_required') WHERE trim(NEW.because) = '';
  SELECT RAISE(ABORT,'workshop_correspondence_policy:owner_act') WHERE NEW.changed_by IS NOT 'founder:' || OLD.founder_id;
  SELECT RAISE(ABORT,'workshop_correspondence_policy:immutable') WHERE NEW.founder_id <> OLD.founder_id;
END;

-- WHAT WAS SAID BACK, WHY, AND ON WHOSE AUTHORITY.
CREATE TABLE workshop_replies (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  -- One answer per message, forever. This is the whole of the exactly-once
  -- property: a retried delivery finds a row and stops.
  mail_id        TEXT NOT NULL UNIQUE REFERENCES workshop_mail(id),
  -- The structured reading the interpreter produced, kept so the owner can see
  -- what was understood separately from what was done about it.
  understood     TEXT NOT NULL,
  intent         TEXT NOT NULL,
  -- What Foundry decided, in its own words, and the grounds.
  decision       TEXT NOT NULL CHECK (decision IN ('answer','answer_and_act','ask_them','escalate','say_nothing')),
  because        TEXT NOT NULL,
  -- The words that went out, exactly.
  says           TEXT,
  -- What else changed in the world because of it, named.
  did            TEXT,
  -- 'foundry' when it went out inside the envelope; 'owner' when he sent it.
  authority      TEXT NOT NULL CHECK (authority IN ('foundry','owner')),
  status         TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','sent','failed','withheld')),
  effect_id      TEXT,
  provider_receipt TEXT,
  sent_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_workshop_replies ON workshop_replies(founder_id, status, created_at);

CREATE TRIGGER workshop_reply_guard
BEFORE INSERT ON workshop_replies
BEGIN
  -- A reply cannot arrive already sent: sending is an act with a receipt, not
  -- a property a row may assert about itself.
  SELECT RAISE(ABORT,'workshop_reply:cannot_arrive_sent') WHERE NEW.status = 'sent'
    OR NEW.sent_at IS NOT NULL OR NEW.provider_receipt IS NOT NULL;
  SELECT RAISE(ABORT,'workshop_reply:grounds_required') WHERE trim(NEW.because) = '';
  -- If it means to say something, there must be something to say.
  SELECT RAISE(ABORT,'workshop_reply:nothing_to_say') WHERE NEW.decision IN ('answer','answer_and_act','ask_them')
    AND trim(coalesce(NEW.says, '')) = '';
  SELECT RAISE(ABORT,'workshop_reply:not_the_workshops') WHERE NOT EXISTS (
    SELECT 1 FROM workshop_mail m WHERE m.id = NEW.mail_id AND m.founder_id = NEW.founder_id);
END;

CREATE TRIGGER workshop_reply_sent_guard
BEFORE UPDATE ON workshop_replies
BEGIN
  SELECT RAISE(ABORT,'workshop_reply:immutable') WHERE
    NEW.mail_id <> OLD.mail_id OR NEW.founder_id <> OLD.founder_id OR NEW.created_at <> OLD.created_at;
  -- Sent is a claim about the world, so it needs the world's answer: the
  -- effect it went out under and the provider's receipt, in the same statement.
  SELECT RAISE(ABORT,'workshop_reply:sent_needs_a_receipt') WHERE NEW.status = 'sent'
    AND (NEW.effect_id IS NULL OR NEW.provider_receipt IS NULL OR NEW.sent_at IS NULL);
  -- What went out cannot be edited afterwards. The record of what a stranger
  -- was told is not a draft.
  SELECT RAISE(ABORT,'workshop_reply:what_was_said_stands') WHERE OLD.status = 'sent'
    AND (NEW.says IS NOT OLD.says OR NEW.status <> 'sent');
END;

-- Erasure: a person's correspondence goes when they do.
CREATE TRIGGER workshop_replies_erasure
BEFORE DELETE ON workshop_replies
BEGIN
  SELECT RAISE(ABORT,'workshop_reply:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;
