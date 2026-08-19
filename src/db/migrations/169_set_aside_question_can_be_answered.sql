-- =============================================================================
-- Migration 169: a question the founder set aside can still be answered
--
-- Foundry asks one question at a time and offers "Skip this". The courtesy
-- behind skipping is right and is unchanged: silence is never read as a
-- negative answer, and Foundry does not ask again.
--
-- But two guards written for the same table disagreed about what "resolved"
-- means. `founder_evidence_request_resolution_guard` treats only 'answered' as
-- terminal. `founder_assertion_guard` required `status='open'`, which made
-- 'deferred' terminal too — so a founder who skipped a question could never
-- tell Foundry the answer afterwards. The route refused with a 403 and no
-- surface listed what had been set aside.
--
-- The consequence was not cosmetic. A required understanding fact that stays
-- unknown keeps its responsibility from being understood, which keeps it off
-- Shadowing, which keeps it off Assisting. One hurried click in the letter
-- silently foreclosed a responsibility for good, and by design Foundry never
-- mentioned it again.
--
-- WHAT THIS CHANGES: 'deferred' is unanswered, not resolved. The assertion
-- guard now accepts an answer to an open OR a deferred question.
--
-- WHAT THIS DOES NOT CHANGE, and what the guard was built to protect:
--
--   * An assertion still cannot answer a question that was never asked — the
--     request row must exist and its predicate must match.
--   * It still cannot answer another tenant's question — product_id is still
--     joined.
--   * A replayed answer is still inert. Answering sets status='answered', and
--     'answered' remains refused here and terminal in the resolution guard, so
--     the same answer cannot be recorded twice.
--   * Identity is still verified against real ownership, and an answer still
--     cannot smuggle authority. Neither clause is touched.
--
-- Nor does this make Foundry ask again. `factOpportunities` still counts a
-- deferred request as settled. The founder reaches a set-aside question by
-- choosing to look at it, which is what makes retrievable different from being
-- asked.
-- =============================================================================

DROP TRIGGER IF EXISTS founder_assertion_guard;

CREATE TRIGGER founder_assertion_guard
BEFORE INSERT ON signal_events WHEN NEW.source='founder_assertion'
BEGIN
  SELECT RAISE(ABORT,'founder_assertion:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.request_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.predicate'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.statement'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.founder_id'),''))='';

  -- The assertion answers an UNANSWERED question of this company. It cannot
  -- answer a question that was never asked, another tenant's question, or one
  -- already answered — which is what makes a replayed answer inert. A question
  -- the founder set aside has not been answered.
  SELECT RAISE(ABORT,'founder_assertion:request_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM founder_evidence_requests q
    WHERE q.id=json_extract(NEW.payload_json,'$.request_id')
      AND q.product_id=NEW.product_id
      AND q.predicate=json_extract(NEW.payload_json,'$.predicate')
      AND q.status IN ('open','deferred'));

  -- Identity is verified against real ownership. A caller-supplied founder
  -- string cannot establish who is speaking for the company.
  SELECT RAISE(ABORT,'founder_assertion:founder_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id=NEW.product_id AND p.owner_id=json_extract(NEW.payload_json,'$.founder_id'));

  -- Founder assertion is not authority. An answer that carries a consent, a
  -- capability, a scope, an expiry, or a mode change is refused outright rather
  -- than stored and ignored — the shape of the attempt is the problem, and a
  -- silently dropped field is a silently granted one waiting to happen.
  SELECT RAISE(ABORT,'founder_assertion:authority_smuggled') WHERE
    json_extract(NEW.payload_json,'$.consent') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.consent_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.capability') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.authority') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.scope') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.to_mode') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.expires_at') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.grant') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.state') IS NOT NULL;
END;
