-- =============================================================================
-- Migration 170: a connected system that is being refused should be visible
--
-- `last_used_at` is written when a credential AUTHENTICATES, and nothing is
-- written when the request that followed was refused. So a rota system posting
-- a slightly wrong field name, or a helpdesk naming an effect that does not
-- exist, looked exactly like one that was working: the credential showed as
-- recently used, and every call it made was thrown away.
--
-- The founder connected that system on the understanding that Foundry would
-- hear from it. An integration that appears to work and does nothing is worse
-- than one that visibly fails, because nobody goes looking.
--
-- WHAT IS RECORDED IS THE SHAPE, NEVER THE CONTENT. A refused body is external
-- data and may carry customer information; none of it lands here. The reason is
-- a closed vocabulary this system owns, enforced by CHECK rather than by
-- convention, so free text cannot be written into it by a future caller with a
-- convenient error string to hand.
-- =============================================================================

ALTER TABLE ingest_credentials ADD COLUMN last_refused_at DATETIME;
ALTER TABLE ingest_credentials ADD COLUMN refusal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_credentials ADD COLUMN last_refusal_reason TEXT
  CHECK (last_refusal_reason IS NULL OR last_refusal_reason IN (
    'body_unreadable',
    'fields_invalid',
    'values_out_of_range',
    'too_large',
    'nothing_recognised',
    'refused_by_the_institution',
    'could_not_store'
  ));
