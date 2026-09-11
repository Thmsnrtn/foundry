-- =============================================================================
-- FOUNDRY — the owner says never this one, and means the business, not an address
--
-- A suppression today is an email address that asked to stop hearing from us.
-- That is the right shape for "this person opted out" and the wrong shape for
-- "I never want my institution contacting that company." An address is one
-- representation of a business; a discovery pass that finds the same company
-- through its website, a second published mailbox, or a differently spelled
-- name would walk straight past a suppression on the first one.
--
-- So an OWNER EXCLUSION names an ENTITY and carries as many stable public marks
-- as can be resolved for it — canonical name, aliases, domains, published
-- mailboxes, published numbers, a location. Any one of them matching is enough
-- to refuse.
--
-- IT OUTRANKS EVERYTHING BELOW IT. Qualification, opportunity score, cohort
-- size, expected value, an autonomous recommendation — none of them is a reason
-- to write to a business the owner has said never to write to. The refusal is
-- in the rows rather than in a page, and it fires where the cohort is formed as
-- well as at the outbound door, so an excluded business cannot even become a
-- participant to be written to later.
--
-- WHY IS INTERNAL. The reason lives here because the institution has to be able
-- to explain its own refusal to its owner. It is never the outside world's
-- business, and nothing external reads this table.
-- =============================================================================

CREATE TABLE owner_exclusions (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  -- The canonical business name, as the owner would say it.
  entity        TEXT NOT NULL,
  -- His reason, for him. Never leaves the institution.
  because       TEXT NOT NULL,
  set_by        TEXT NOT NULL,
  set_at        TEXT NOT NULL DEFAULT (datetime('now')),
  lifted_at     TEXT,
  lifted_by     TEXT,
  lifted_reason TEXT
);

CREATE TABLE owner_exclusion_marks (
  id           TEXT PRIMARY KEY,
  exclusion_id TEXT NOT NULL REFERENCES owner_exclusions(id),
  kind         TEXT NOT NULL CHECK (kind IN ('name','domain','email','phone','address')),
  -- Lower-cased and trimmed at the door, so a match is a comparison and not a
  -- hope. A name mark is matched as a substring; the rest are exact or suffix.
  value        TEXT NOT NULL,
  source       TEXT NOT NULL,
  UNIQUE(exclusion_id, kind, value)
);

CREATE INDEX owner_exclusion_marks_value ON owner_exclusion_marks (kind, value);

CREATE TRIGGER owner_exclusion_guard
BEFORE INSERT ON owner_exclusions
BEGIN
  SELECT RAISE(ABORT,'owner_exclusion:incomplete')
    WHERE trim(NEW.entity) = '' OR trim(NEW.because) = '' OR trim(NEW.set_by) = '';
  SELECT RAISE(ABORT,'owner_exclusion:cannot_arrive_lifted')
    WHERE NEW.lifted_at IS NOT NULL;
END;

CREATE TRIGGER owner_exclusion_lift_is_the_owners
BEFORE UPDATE ON owner_exclusions
BEGIN
  -- WHAT HE SAID IS WHAT HE SAID. Only the lifting fields move.
  SELECT RAISE(ABORT,'owner_exclusion:immutable')
    WHERE NEW.entity IS NOT OLD.entity OR NEW.because IS NOT OLD.because
       OR NEW.founder_id IS NOT OLD.founder_id OR NEW.set_by IS NOT OLD.set_by
       OR NEW.set_at IS NOT OLD.set_at;
  SELECT RAISE(ABORT,'owner_exclusion:already_lifted')
    WHERE OLD.lifted_at IS NOT NULL;
  -- AND LIFTING IT IS A DECISION WITH A NAME AND A REASON ON IT. An exclusion
  -- that could be lifted by the institution would not be an owner boundary.
  SELECT RAISE(ABORT,'owner_exclusion:lift_needs_the_owner_and_a_reason')
    WHERE NEW.lifted_at IS NOT NULL
      AND (trim(coalesce(NEW.lifted_reason,'')) = ''
        OR NEW.lifted_by IS NOT 'founder:' || OLD.founder_id);
END;

CREATE TRIGGER owner_exclusion_mark_guard
BEFORE INSERT ON owner_exclusion_marks
BEGIN
  SELECT RAISE(ABORT,'owner_exclusion_mark:incomplete')
    WHERE trim(NEW.value) = '' OR trim(NEW.source) = '';
  SELECT RAISE(ABORT,'owner_exclusion_mark:not_normalised')
    WHERE NEW.value <> lower(trim(NEW.value));
  -- A ONE-LETTER NAME MARK WOULD EXCLUDE THE WORLD. Substring matching earns
  -- its power by refusing to be given a value too short to mean anything.
  SELECT RAISE(ABORT,'owner_exclusion_mark:name_too_broad')
    WHERE NEW.kind = 'name' AND length(NEW.value) < 6;
  SELECT RAISE(ABORT,'owner_exclusion_mark:no_such_exclusion')
    WHERE NOT EXISTS (SELECT 1 FROM owner_exclusions x WHERE x.id = NEW.exclusion_id);
END;

CREATE TRIGGER owner_exclusion_mark_immutable
BEFORE UPDATE ON owner_exclusion_marks
BEGIN
  SELECT RAISE(ABORT,'owner_exclusion_mark:immutable');
END;

-- ── Where it bites, first ────────────────────────────────────────────────────
--
-- AT COHORT FORMATION, not at sending. An excluded business must never become
-- a participant at all: a row that exists is a row some later pass can qualify,
-- score, approve and write to. This refuses it entering.

CREATE TRIGGER experiment_recipient_owner_exclusion
BEFORE INSERT ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:owner_excluded') WHERE EXISTS (
    SELECT 1 FROM owner_exclusion_marks m
      JOIN owner_exclusions x ON x.id = m.exclusion_id
     WHERE x.founder_id = NEW.founder_id AND x.lifted_at IS NULL
       AND ((m.kind = 'email'  AND lower(trim(coalesce(NEW.email,''))) = m.value)
         OR (m.kind = 'domain' AND lower(coalesce(NEW.email,'')) LIKE '%@' || m.value)
         OR (m.kind = 'domain' AND lower(coalesce(NEW.source_url,'')) LIKE '%' || m.value || '%')
         OR (m.kind = 'name'   AND lower(NEW.counterparty_ref) LIKE '%' || m.value || '%')));
END;

CREATE TRIGGER experiment_recipient_owner_exclusion_update
BEFORE UPDATE OF email, counterparty_ref, source_url ON experiment_recipients
BEGIN
  SELECT RAISE(ABORT,'experiment_recipient:owner_excluded') WHERE EXISTS (
    SELECT 1 FROM owner_exclusion_marks m
      JOIN owner_exclusions x ON x.id = m.exclusion_id
     WHERE x.founder_id = NEW.founder_id AND x.lifted_at IS NULL
       AND ((m.kind = 'email'  AND lower(trim(coalesce(NEW.email,''))) = m.value)
         OR (m.kind = 'domain' AND lower(coalesce(NEW.email,'')) LIKE '%@' || m.value)
         OR (m.kind = 'name'   AND lower(NEW.counterparty_ref) LIKE '%' || m.value || '%')));
END;

-- ── And again at the last door ───────────────────────────────────────────────
--
-- Belt and braces, deliberately. The recipient guard is the one that matters;
-- this one exists because an outbound action is the thing that actually reaches
-- somebody, and a guard at the point of consequence should not depend on every
-- earlier guard having been right.

CREATE TRIGGER outbound_action_owner_exclusion
BEFORE INSERT ON outbound_actions
BEGIN
  SELECT RAISE(ABORT,'outbound_action:owner_excluded') WHERE EXISTS (
    SELECT 1 FROM owner_exclusion_marks m
      JOIN owner_exclusions x ON x.id = m.exclusion_id
     WHERE x.lifted_at IS NULL
       AND ((m.kind = 'email'  AND lower(coalesce(json_extract(NEW.parameters_json,'$.to[0]'),'')) = m.value)
         OR (m.kind = 'domain' AND lower(coalesce(json_extract(NEW.parameters_json,'$.to[0]'),'')) LIKE '%@' || m.value)));
END;
