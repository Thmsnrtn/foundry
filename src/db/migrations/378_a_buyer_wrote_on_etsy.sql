-- =============================================================================
-- A BUYER WROTE ON ETSY.
--
-- Etsy publishes no way to read a shop's messages, so a buyer waiting was
-- visible only to an owner who happened to open Etsy. Etsy does email the
-- owner when a buyer writes, and the owner can forward those emails to the
-- Workshop's address, which already reaches Foundry.
--
-- WHAT IS KEPT, AND WHAT IS DELIBERATELY NOT. The shop's published privacy
-- policy says its records hold "the order number and the amount, never your
-- name or email". So this keeps that a buyer wrote, when, which saved reply the
-- rules think fits and the words OF OURS that matched — never the buyer's name,
-- address, subject line or message. The owner reads the message itself where
-- it lives, on Etsy, which is also where the reply is sent.
--
-- NOT THE WORKSHOP'S MAIL. `workshop_mail` feeds the Workshop's own
-- correspondence, which answers by email; the address it would answer here is
-- Etsy's notifier, or the owner. These never enter it.
--
-- The email's own Message-ID is kept only as a hash: enough to know the same
-- email twice is one buyer, and nothing anybody could read back.
-- =============================================================================
CREATE TABLE etsy_mail_heard (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  rfc_hash        TEXT NOT NULL,
  -- A buyer, or something else Etsy sends (a sale notice, an account code),
  -- which is recorded only so a redelivery is recognised and nothing is asked.
  kind            TEXT NOT NULL CHECK (kind IN ('buyer_message', 'not_a_buyer')),
  -- A key of SAVED_REPLIES (services/venture/etsy-messages.ts), or null when
  -- no rule recognised the message — then the owner chooses, on Etsy.
  suggested_reply TEXT,
  because         TEXT NOT NULL,
  heard_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- Said by the owner. Foundry cannot see Etsy's side, so this is his word.
  answered_at     TEXT,
  UNIQUE (founder_id, rfc_hash)
);

CREATE TRIGGER etsy_mail_heard_only_buyers_are_answered
BEFORE UPDATE OF answered_at ON etsy_mail_heard
WHEN NEW.answered_at IS NOT NULL AND NEW.kind <> 'buyer_message'
BEGIN SELECT RAISE(ABORT, 'etsy_mail_heard:only_a_buyer_is_answered'); END;
