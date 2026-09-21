-- =============================================================================
-- A RECIPE'S INTENTION IS NOT AN OBSERVED FACT.
--
-- `structural_facts.basis` already says where a claim came from — and the
-- policy that consumes those facts never looks at it. A fact written because
-- THE RECIPE SAID SO satisfies a binding requirement exactly as a fact
-- somebody went and checked would, and nothing anywhere says which it was.
--
-- The offer composition for a brief asserts, before anything exists, that the
-- asset keeps no persistent personal data, sells to nobody across a border,
-- and carries no support obligation. Each is a sentence about what the recipe
-- INTENDS. An order record holds the buyer's email. An intended US audience is
-- not an enforced one: a public payment link takes a card from anywhere.
-- A refund policy does not make delivery failures and remedies disappear —
-- this institution proved it carries exactly those obligations one wave ago.
--
-- This is the observation-integrity campaign turned inward. Foundry has spent
-- this whole campaign learning not to treat a configuration row as proof that
-- an external path works. The same discipline belongs on the premises that
-- decide what it is ALLOWED to do, and it was not there.
--
-- So the vocabulary gains the distinctions the policy needs to tell apart:
--
--   enforced  — a named control makes it true, and would refuse otherwise
--   observed  — somebody looked at the world and this is what was there
--   assumed   — believed on the strength of intent; nothing checks it
--
-- `offer_shape` is kept for the rows already written under it, so no history
-- is rewritten: what was recorded is what was recorded. New rows say which of
-- the three they are.
-- =============================================================================

CREATE TABLE structural_facts_new (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('company','opportunity')),
  subject_id     TEXT NOT NULL,
  fact           TEXT NOT NULL REFERENCES structural_fact_kinds(fact),
  present        INTEGER CHECK (present IN (0,1)),
  -- WHAT KIND OF CLAIM THIS IS, which is the whole point of the column.
  --   enforced: a named control makes it true
  --   observed: somebody looked
  --   assumed:  believed on intent alone
  --   stated / assumed_by_lighter / offer_shape: how earlier rows were written
  --   unknown:  nobody has answered it
  basis          TEXT NOT NULL CHECK (basis IN
                   ('enforced','observed','assumed','stated','assumed_by_lighter','offer_shape','unknown')),
  -- The words the answer rests on, copied from the record it was read from.
  grounds        TEXT,
  -- WHAT MAKES IT TRUE, for an enforced claim: the control that would refuse.
  -- A claim that says "enforced" and cannot name what enforces it is an
  -- assumption wearing a better word, and the trigger below says so.
  enforced_by    TEXT,
  recognised_by  TEXT NOT NULL,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at  TEXT
);

INSERT INTO structural_facts_new
  (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds,
   recognised_by, evidence_mode, recorded_at, superseded_at)
SELECT id, founder_id, subject_kind, subject_id, fact, present, basis, grounds,
       recognised_by, evidence_mode, recorded_at, superseded_at
  FROM structural_facts;

DROP TABLE structural_facts;
ALTER TABLE structural_facts_new RENAME TO structural_facts;

CREATE UNIQUE INDEX structural_facts_live
  ON structural_facts(subject_kind, subject_id, fact) WHERE superseded_at IS NULL;
CREATE INDEX idx_structural_facts_subject ON structural_facts(subject_kind, subject_id);

CREATE TRIGGER structural_fact_enforced_names_its_control
BEFORE INSERT ON structural_facts
BEGIN
  SELECT RAISE(ABORT,'structural_fact:enforced_names_nothing')
    WHERE NEW.basis = 'enforced' AND (NEW.enforced_by IS NULL OR trim(NEW.enforced_by) = '');
END;
