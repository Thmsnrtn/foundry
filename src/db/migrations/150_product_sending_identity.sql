-- =============================================================================
-- Migration 150: the founder's own sender, so third-party mail can have one
--
-- `services/outbound/sender-of-record.ts` has always said Foundry must never be
-- the From on a message to a founder's CUSTOMER: those go out under the
-- founder's own connected sender — their domain, their opt-out footer, their
-- CAN-SPAM responsibility. The guard was written, and had zero callers, and the
-- live send path defaulted to a Foundry domain.
--
-- Wiring the guard alone could not fix that, because the thing the rule
-- presupposes did not exist: every send in this system went through Foundry's
-- platform Resend key, so no caller COULD satisfy it. This is that thing.
--
-- WHY A CREDENTIAL AND NOT JUST AN ADDRESS. Recording a From address the
-- founder typed would be a verification we cannot perform — nothing here can
-- check that they own the domain, and a `verified_at` we set ourselves would
-- be a claim with no evidence behind it. Sending through the FOUNDER'S OWN
-- provider account makes the verification real and performed by somebody who
-- can actually do it: the provider refuses to send from a domain the account
-- has not verified. It also makes the rule's substance true rather than
-- cosmetic — the reputation, the bounce handling and the compliance obligation
-- land on the account that owns the domain.
--
-- One identity per product. A company sends as itself.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_sending_identities (
  product_id   TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,

  -- Which provider account the mail goes through. Closed vocabulary: adding a
  -- provider is a code change in the send boundary, so it is a code change
  -- here too.
  provider     TEXT NOT NULL CHECK(provider IN ('resend')),

  -- The founder's own API key for that provider, encrypted at rest exactly as
  -- integration credentials are. This is what makes the send THEIRS.
  credential   TEXT NOT NULL,

  -- The From this company's third-party mail goes out as. The provider refuses
  -- it unless the account has verified the domain, which is the verification.
  from_email   TEXT NOT NULL,
  from_name    TEXT,

  -- When a send through this identity was last accepted by the provider.
  -- NULL means "connected but never used" — distinct from "connected and
  -- working", and the two must not look the same on a settings page.
  last_accepted_at DATETIME,

  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
