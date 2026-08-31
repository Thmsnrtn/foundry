-- =============================================================================
-- Migration 171: a support channel turning customers away should be visible
--
-- The twin of migration 170, on the intake that matters most. A customer wrote
-- to a company and Foundry threw the message away — wrong field, oversized
-- body, malformed timestamp — and nothing anywhere recorded that it happened.
-- The founder sees an inbox that is quiet and concludes nobody has written.
--
-- This is worse than a metrics integration failing quietly. A metric can be
-- resent. A person who wrote once and got no answer does not write again.
--
-- WHAT IS RECORDED IS THE SHAPE, NEVER THE MESSAGE. The refused body is the
-- customer's own words and their address: none of it lands here, and the reason
-- is a closed vocabulary enforced by CHECK so no error string can be written in
-- its place. Foundry may say "I turned four away and could not read what they
-- sent"; it may not keep what it refused to accept.
-- =============================================================================

ALTER TABLE support_channels ADD COLUMN last_refused_at TEXT;
ALTER TABLE support_channels ADD COLUMN refusal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_channels ADD COLUMN last_refusal_reason TEXT
  CHECK (last_refusal_reason IS NULL OR last_refusal_reason IN (
    'body_unreadable',
    'fields_invalid',
    'identity_required',
    'contact_required',
    'content_required',
    'content_too_large',
    'timestamp_invalid'
  ));
