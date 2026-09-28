-- =============================================================================
-- 361 — WHEN A VENUE ASKS FOUNDRY TO WAIT.
--
-- Roadmap B5. A 429 is the venue saying "not so often", and each pass asked
-- again at once. `read_not_before` holds the moment the venue said it may be
-- asked again (its Retry-After, a minute when it gave none, never more than a
-- day). No read is attempted before it; a good read clears it. The silence
-- meanwhile is still not evidence: the read is recorded as failed in
-- `last_error`, so readiness and settlement wait as for any failed read.
-- =============================================================================

ALTER TABLE company_senses ADD COLUMN read_not_before TEXT;
