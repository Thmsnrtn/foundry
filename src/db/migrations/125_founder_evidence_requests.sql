-- Migration 125: progressive founder evidence elicitation.
--
-- The blocker this closes: production companies could not enter Understanding,
-- because the facts a responsibility needs to be understood — what it is for,
-- what a good outcome is, what must never happen — are not observable in any
-- system Foundry connects to. They live with the founder. Foundry had no honest
-- way to obtain them, and inventing them from weak signals is the one
-- unrecoverable mistake, so every rung above Visible stayed unreachable.
--
-- Owner decision: Foundry MAY ask the authenticated founder for a missing
-- material fact when a grounded responsibility exists, the exact missing fact
-- is identifiable, canonical evidence cannot establish it, and asking is
-- materially useful. One contextual question at a time. Never a questionnaire.
--
-- Reuse before invention. A founder answer is ordinary canonical evidence: it
-- enters as a `signal_events` row like every other observation of company
-- reality, and the existing reconstruction machinery derives a bounded claim
-- from it. No parallel founder-knowledge store, no new claim kind, and nothing
-- writes Understanding state directly.
--
-- The only genuinely new thing is the *question* — which fact Foundry asked
-- about, and what became of the asking. That is an attention record, not a
-- knowledge record: it exists so the same unanswered question is not put in
-- front of the founder twice, and so silence is never mistaken for an answer.
--
-- CONSTITUTIONAL BOUNDARY: a founder assertion is evidence and nothing else.
-- It is not authority, not a consent, not a capability grant, and not
-- responsibility maturity. This table therefore has no consent, capability,
-- scope, expiry, or permission column, and the answer guard below refuses any
-- payload that tries to smuggle one in.
CREATE TABLE founder_evidence_requests (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products(id),
  responsibility_id TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  predicate         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','deferred')),
  answer_signal_id  TEXT REFERENCES signal_events(id),
  asked_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at       TEXT
);

-- Question identity is the fact being asked about, not a random row. Asking the
-- same question again finds the same request rather than creating a second one.
CREATE UNIQUE INDEX idx_founder_evidence_request_identity
  ON founder_evidence_requests(product_id,responsibility_id,predicate);

CREATE TRIGGER founder_evidence_request_guard
BEFORE INSERT ON founder_evidence_requests
BEGIN
  -- A question is always about this company's own responsibility.
  SELECT RAISE(ABORT,'founder_evidence:responsibility_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id);

  -- Closed vocabulary, mirroring the institutional understanding requirements.
  -- Foundry may only ask about a fact the institution actually requires; it may
  -- not invent a field to be curious about. Widening this list means editing a
  -- migration, which is inside the constitutional ring.
  SELECT RAISE(ABORT,'founder_evidence:predicate_invalid') WHERE NEW.predicate NOT IN (
    'purpose','desired_outcome','success_conditions','failure_conditions','operating_constraints',
    'dependencies','systems','current_carrier','commitments','authority_requirements',
    'capability_requirements','risks','failure_modes','stakeholder_obligations','financial_consequence');

  -- A question is born unanswered. A request cannot be created already resolved,
  -- so an answer can never exist without the founder having given one.
  SELECT RAISE(ABORT,'founder_evidence:born_unanswered')
  WHERE NEW.status<>'open' OR NEW.answer_signal_id IS NOT NULL OR NEW.resolved_at IS NOT NULL;
END;

CREATE TRIGGER founder_evidence_request_resolution_guard
BEFORE UPDATE ON founder_evidence_requests
BEGIN
  -- What was asked never changes. Rewriting the question after the fact would
  -- let one answer be reused as the answer to a different question.
  SELECT RAISE(ABORT,'founder_evidence:immutable_question') WHERE
    NEW.product_id<>OLD.product_id OR NEW.responsibility_id<>OLD.responsibility_id
    OR NEW.predicate<>OLD.predicate OR NEW.asked_at<>OLD.asked_at;

  -- Answered is terminal. A replayed or resubmitted answer changes nothing;
  -- the founder changing their mind appends a new claim through a new
  -- observation, and the original answer survives as history.
  SELECT RAISE(ABORT,'founder_evidence:already_resolved') WHERE OLD.status='answered';

  -- Silence is not an answer. Deferral must not carry evidence with it.
  SELECT RAISE(ABORT,'founder_evidence:deferral_carries_evidence')
  WHERE NEW.status='deferred' AND NEW.answer_signal_id IS NOT NULL;

  -- An answered request must point at a real founder assertion for this
  -- company, about this exact question.
  SELECT RAISE(ABORT,'founder_evidence:answer_invalid')
  WHERE NEW.status='answered' AND NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE e.id=NEW.answer_signal_id AND e.product_id=NEW.product_id
      AND e.source='founder_assertion'
      AND json_extract(e.payload_json,'$.request_id')=NEW.id
      AND json_extract(e.payload_json,'$.predicate')=NEW.predicate);
END;

-- A founder assertion is a canonical observation of company reality, recorded
-- through the ordinary evidence path. These are the properties that make it
-- trustworthy as evidence rather than as an instruction.
CREATE TRIGGER founder_assertion_guard
BEFORE INSERT ON signal_events WHEN NEW.source='founder_assertion'
BEGIN
  SELECT RAISE(ABORT,'founder_assertion:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.request_id'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.predicate'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.statement'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.founder_id'),''))='';

  -- The assertion answers an OPEN question of this company. It cannot answer a
  -- question that was never asked, another tenant's question, or one already
  -- resolved — which is what makes a replayed answer inert.
  SELECT RAISE(ABORT,'founder_assertion:request_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM founder_evidence_requests q
    WHERE q.id=json_extract(NEW.payload_json,'$.request_id')
      AND q.product_id=NEW.product_id
      AND q.predicate=json_extract(NEW.payload_json,'$.predicate')
      AND q.status='open');

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
