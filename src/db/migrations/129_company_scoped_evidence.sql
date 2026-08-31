-- Migration 129: company-scoped founder evidence, and the inputs institutional
-- judgment was missing.
--
-- Owner decision: genuinely company-wide facts belong at COMPANY scope. Total
-- resource capacity is a property of the company, not of each responsibility
-- that competes for it, and duplicating it per responsibility would mean the
-- same fact could disagree with itself. The relationship is:
--
--   company evidence → company-scoped claim → responsibilities and judgments
--   reference that one claim
--
-- Scope follows the meaning of the evidence, never implementation convenience.
--
-- The reason this is small: `founder_evidence_requests` already exists, and a
-- company-scoped question still names the responsibility that is blocked by it.
-- That is not redundancy — it is the concrete institutional reason the question
-- is being asked at all. A company-wide question with no blocked work behind it
-- is the questionnaire the owner ruled out.
ALTER TABLE founder_evidence_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'responsibility';

-- One question per company fact, however many responsibilities need it. Without
-- this, three blocked responsibilities would produce three identical questions
-- about the same company-wide number.
CREATE UNIQUE INDEX idx_founder_company_fact
  ON founder_evidence_requests(product_id,predicate) WHERE scope='company';

DROP TRIGGER IF EXISTS founder_evidence_request_guard;

CREATE TRIGGER founder_evidence_request_guard
BEFORE INSERT ON founder_evidence_requests
BEGIN
  SELECT RAISE(ABORT,'founder_evidence:scope_invalid')
  WHERE NEW.scope NOT IN ('responsibility','company');

  -- Every question names the responsibility it unblocks, at either scope.
  SELECT RAISE(ABORT,'founder_evidence:responsibility_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities r
    WHERE r.id=NEW.responsibility_id AND r.product_id=NEW.product_id);

  -- Closed vocabularies, one per scope. A responsibility-scoped predicate may
  -- not be asked company-wide and a company-wide one may not be pinned to a
  -- single responsibility: the scope must follow the meaning of the fact.
  --
  -- `resource_demand` is responsibility-scoped and `resource_capacity` is
  -- company-scoped because that is what they are — what one piece of work costs
  -- versus what the whole company has. They are the two inputs deterministic
  -- capacity judgment reads, and they are the only ones added here. The other
  -- company-wide predicates the owner named (cash constraint, operating
  -- schedule, owner constraint, organisation dependency, company risk, company
  -- policy) are deliberately absent until something consumes them; adding a
  -- field before its consumer exists is how orphans are made.
  SELECT RAISE(ABORT,'founder_evidence:predicate_invalid')
  WHERE (NEW.scope='responsibility' AND NEW.predicate NOT IN (
    'purpose','desired_outcome','success_conditions','failure_conditions','operating_constraints',
    'dependencies','systems','current_carrier','commitments','authority_requirements',
    'capability_requirements','risks','failure_modes','stakeholder_obligations','financial_consequence',
    'resource_demand'))
     OR (NEW.scope='company' AND NEW.predicate NOT IN ('resource_capacity'));

  SELECT RAISE(ABORT,'founder_evidence:born_unanswered')
  WHERE NEW.status<>'open' OR NEW.answer_signal_id IS NOT NULL OR NEW.resolved_at IS NOT NULL;
END;

-- Scope is part of what was asked, so it is as immutable as the question.
-- Re-pointing a company fact at one responsibility after it was answered would
-- silently narrow evidence the whole company relies on.
DROP TRIGGER IF EXISTS founder_evidence_request_resolution_guard;

CREATE TRIGGER founder_evidence_request_resolution_guard
BEFORE UPDATE ON founder_evidence_requests
BEGIN
  SELECT RAISE(ABORT,'founder_evidence:immutable_question') WHERE
    NEW.product_id<>OLD.product_id OR NEW.responsibility_id<>OLD.responsibility_id
    OR NEW.predicate<>OLD.predicate OR NEW.asked_at<>OLD.asked_at OR NEW.scope<>OLD.scope;

  SELECT RAISE(ABORT,'founder_evidence:already_resolved') WHERE OLD.status='answered';

  SELECT RAISE(ABORT,'founder_evidence:deferral_carries_evidence')
  WHERE NEW.status='deferred' AND NEW.answer_signal_id IS NOT NULL;

  SELECT RAISE(ABORT,'founder_evidence:answer_invalid')
  WHERE NEW.status='answered' AND NOT EXISTS (
    SELECT 1 FROM signal_events e
    WHERE e.id=NEW.answer_signal_id AND e.product_id=NEW.product_id
      AND e.source='founder_assertion'
      AND json_extract(e.payload_json,'$.request_id')=NEW.id
      AND json_extract(e.payload_json,'$.predicate')=NEW.predicate);
END;
