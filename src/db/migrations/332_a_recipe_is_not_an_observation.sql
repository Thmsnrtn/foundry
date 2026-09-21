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

CREATE UNIQUE INDEX idx_structural_fact_live
  ON structural_facts(subject_kind, subject_id, fact) WHERE superseded_at IS NULL;

-- ─── AND EVERY GUARD THE OLD TABLE CARRIED ──────────────────────────────────
--
-- A rebuild drops the triggers with the table, and the first version of this
-- migration recreated one of them. The institution then accepted a fact whose
-- basis said `unknown` while its answer said otherwise, and accepted an edit
-- to a recorded fact in place — two guarantees quietly gone in a migration
-- about honesty. The proof that holds them caught it.
--
-- Restated verbatim, with the new column folded into the one that governs it.

CREATE TRIGGER structural_fact_guard
BEFORE INSERT ON structural_facts
BEGIN
  SELECT RAISE(ABORT,'structural_fact:incomplete')
    WHERE trim(NEW.subject_id) = '' OR trim(NEW.recognised_by) = '';
  -- AN UNKNOWN HAS NO BASIS BUT UNKNOWN, AND A KNOWN ANSWER IS NOT UNKNOWN.
  SELECT RAISE(ABORT,'structural_fact:unknown_means_unknown')
    WHERE (NEW.present IS NULL) <> (NEW.basis = 'unknown');
  SELECT RAISE(ABORT,'structural_fact:cannot_arrive_superseded')
    WHERE NEW.superseded_at IS NOT NULL;
  -- A CLAIM THAT SAYS SOMETHING ENFORCES IT MUST SAY WHAT. Without this,
  -- `enforced` is `assumed` wearing a better word, and the word is the only
  -- thing the policy has to go on.
  SELECT RAISE(ABORT,'structural_fact:enforced_names_nothing')
    WHERE NEW.basis = 'enforced' AND (NEW.enforced_by IS NULL OR trim(NEW.enforced_by) = '');
END;

CREATE TRIGGER structural_fact_supersede_only
BEFORE UPDATE ON structural_facts
BEGIN
  SELECT RAISE(ABORT,'structural_fact:immutable_except_supersession')
    WHERE NEW.present IS NOT OLD.present OR NEW.basis IS NOT OLD.basis
       OR NEW.grounds IS NOT OLD.grounds OR NEW.fact IS NOT OLD.fact
       OR NEW.enforced_by IS NOT OLD.enforced_by;
END;
