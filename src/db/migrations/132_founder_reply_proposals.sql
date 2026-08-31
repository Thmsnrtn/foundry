-- Migration 132: authenticated founder-authored reply proposals.
--
-- Audit before adding a noun:
--
--   • `action_drafts` (022) is the pre-institution drafting store: no
--     responsibility, no consent, no effect identity, no tenant guard, free-text
--     status and owner. It cannot carry a governed proposal truthfully.
--   • `outbound_actions` (021, extended by 114) IS the canonical action-plan
--     primitive — responsibility, authority consent, authority scope, effect
--     identity, outcome status — and `planAssistedSupportEmail` already writes
--     it. That is the PLAN, and it stays the plan.
--
-- So the proposal needs no table at all. A founder-authored reply is one more
-- authenticated thing the founder said, and this system already has a canonical,
-- tenant-guarded, provenance-bearing event log for that. The proposal is a
-- `signal_events` row; the plan remains an `outbound_actions` row. Two nouns,
-- two meanings, no third store and no dual write.
--
-- THE EVIDENCE BOUNDARY, stated because it is easy to get wrong: a founder's
-- proposed reply is a canonical *event* — it happened, the founder wrote it —
-- and it is NOT company evidence. No reconstruction claim is derived from it.
-- What a founder proposes to tell a customer is not a fact about the company,
-- and treating it as one would let drafting quietly rewrite company truth.
--
-- Preserved: message != proposal, proposal != consent, proposal != plan,
-- plan != execution, execution != receipt, receipt != business outcome.
CREATE TRIGGER founder_reply_proposal_guard
BEFORE INSERT ON signal_events WHEN NEW.source='founder_reply_proposal'
BEGIN
  SELECT RAISE(ABORT,'reply_proposal:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.message_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.founder_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.body'),''))=''
    OR length(coalesce(json_extract(NEW.payload_json,'$.body'),''))>8192;

  -- A proposal answers one real message of this company. There is no way to
  -- author a reply to a message that does not exist or belongs elsewhere.
  SELECT RAISE(ABORT,'reply_proposal:message_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM inbound_customer_messages m
    WHERE m.id=json_extract(NEW.payload_json,'$.message_id')
      AND m.product_id=NEW.product_id);

  -- Authorship is verified against real ownership, never taken from the body.
  SELECT RAISE(ABORT,'reply_proposal:founder_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id=NEW.product_id AND p.owner_id=json_extract(NEW.payload_json,'$.founder_id'));

  -- Writing a reply is not deciding what Foundry may do with it. A proposal
  -- carrying responsibility, capability, scope, consent, consequence, recipient
  -- or maturity is refused whole — every one of those is resolved server-side
  -- from the message and the responsibility that owns its channel.
  SELECT RAISE(ABORT,'reply_proposal:authority_smuggled') WHERE
    json_extract(NEW.payload_json,'$.responsibility_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.capability') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.scope') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.consent') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.consent_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.authority') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.to_mode') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.consequence_boundary') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.to') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.recipient') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.state') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.outcome_status') IS NOT NULL;
END;

-- The plan binds durably to the message it answers and the proposal it carries.
-- Both are on the existing canonical plan row: a plan that cannot name its
-- message is a reply to nothing in particular.
ALTER TABLE outbound_actions ADD COLUMN inbound_message_id TEXT REFERENCES inbound_customer_messages(id);
ALTER TABLE outbound_actions ADD COLUMN reply_proposal_id TEXT REFERENCES signal_events(id);

CREATE TRIGGER assisted_reply_plan_binding_guard
BEFORE INSERT ON outbound_actions WHEN NEW.inbound_message_id IS NOT NULL
BEGIN
  -- The message must be this company's, and the responsibility on the plan must
  -- be the one that owns the channel the message arrived on. A proposal for one
  -- message cannot be planned against another, and one responsibility cannot
  -- claim another's customer.
  SELECT RAISE(ABORT,'assisted_reply:message_binding_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM inbound_customer_messages m
    WHERE m.id=NEW.inbound_message_id AND m.product_id=NEW.product_id
      AND m.responsibility_id=NEW.responsibility_id);

  -- The plan must carry a real proposal, authored for that same message.
  SELECT RAISE(ABORT,'assisted_reply:proposal_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE e.id=NEW.reply_proposal_id AND e.product_id=NEW.product_id
      AND e.source='founder_reply_proposal'
      AND json_extract(e.payload_json,'$.message_id')=NEW.inbound_message_id);
END;

-- One plan per inbound message. Without this, a second planning call for the
-- same customer message would create a second sendable action — the founder
-- would have no way to know two replies were queued for one question.
CREATE UNIQUE INDEX idx_assisted_action_message
  ON outbound_actions(product_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;
