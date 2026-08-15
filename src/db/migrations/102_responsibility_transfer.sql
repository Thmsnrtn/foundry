-- Canonical, company-scoped responsibility truth and atomic transition ledger.
CREATE TABLE IF NOT EXISTS institutional_responsibilities (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'unknown' CHECK(state IN (
    'unknown','visible','understood','shadowing','assisting','operating','mature','exception_owned'
  )),
  evidence_ref TEXT,
  authority_ref TEXT,
  outcome_ref TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_responsibilities_product_state
  ON institutional_responsibilities(product_id, state, updated_at);

CREATE TABLE IF NOT EXISTS responsibility_transitions (
  id TEXT PRIMARY KEY,
  responsibility_id TEXT NOT NULL REFERENCES institutional_responsibilities(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  evidence_ref TEXT,
  authority_ref TEXT,
  outcome_ref TEXT,
  reason TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_responsibility_transitions
  ON responsibility_transitions(responsibility_id, created_at);

CREATE TRIGGER IF NOT EXISTS responsibility_transition_guard
BEFORE INSERT ON responsibility_transitions
BEGIN
  SELECT RAISE(ABORT, 'responsibility_transition:stale_state') WHERE NOT EXISTS (
    SELECT 1 FROM institutional_responsibilities
    WHERE id = NEW.responsibility_id AND state = NEW.from_state
  );
  SELECT RAISE(ABORT, 'responsibility_transition:no_change') WHERE NEW.from_state = NEW.to_state;
  -- Promotions advance exactly one rung; demotion may move to any lower rung.
  SELECT RAISE(ABORT, 'responsibility_transition:cannot_skip') WHERE
    instr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', '|' || NEW.to_state || '|') >
    instr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', '|' || NEW.from_state || '|')
    AND (
      length(substr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', 1,
        instr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', '|' || NEW.to_state || '|'))) -
      length(replace(substr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', 1,
        instr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', '|' || NEW.to_state || '|')), '|', ''))
    ) > (
      length(substr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', 1,
        instr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', '|' || NEW.from_state || '|'))) -
      length(replace(substr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', 1,
        instr('|unknown|visible|understood|shadowing|assisting|operating|mature|exception_owned|', '|' || NEW.from_state || '|')), '|', '')) + 1
    );
  SELECT RAISE(ABORT, 'responsibility_transition:evidence_required') WHERE NEW.to_state <> 'unknown' AND NEW.evidence_ref IS NULL;
  SELECT RAISE(ABORT, 'responsibility_transition:authority_required') WHERE NEW.to_state IN ('assisting','operating','mature','exception_owned') AND NEW.authority_ref IS NULL;
  SELECT RAISE(ABORT, 'responsibility_transition:outcome_required') WHERE NEW.to_state IN ('mature','exception_owned') AND NEW.outcome_ref IS NULL;
  SELECT RAISE(ABORT, 'responsibility_transition:authority_not_applicable') WHERE NEW.to_state IN ('unknown','visible','understood','shadowing') AND NEW.authority_ref IS NOT NULL;
  SELECT RAISE(ABORT, 'responsibility_transition:outcome_not_applicable') WHERE NEW.to_state NOT IN ('mature','exception_owned') AND NEW.outcome_ref IS NOT NULL;
END;

CREATE TRIGGER IF NOT EXISTS responsibility_transition_apply
AFTER INSERT ON responsibility_transitions
BEGIN
  UPDATE institutional_responsibilities SET
    state = NEW.to_state,
    evidence_ref = NEW.evidence_ref,
    authority_ref = NEW.authority_ref,
    outcome_ref = NEW.outcome_ref,
    updated_at = NEW.created_at
  WHERE id = NEW.responsibility_id AND state = NEW.from_state;
END;
