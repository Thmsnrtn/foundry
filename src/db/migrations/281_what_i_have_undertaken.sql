-- =============================================================================
-- WHAT I HAVE UNDERTAKEN
--
-- The owner could tell the institution what a company is FOR, what it must NOT
-- do, what it MAY spend, and which way to LEAN. He could not tell it to DO
-- anything. "Investigate why customers aren't converting", "fix it", "spend
-- less here", "handle it" fell to "I did not follow that", or were quietly
-- filed as what the company is for. And the institution's own work had no
-- thread: a situation led to advice, advice led to nothing as a row, an act
-- was proposed by nobody, and "what are you doing for this company" could be
-- listed by union but never followed.
--
-- A RESPONSIBILITY is enduring accountability. An UNDERTAKING is a bounded
-- episode of work: what was asked, in the owner's words; what it was
-- understood as, shown to him before it bound; where it came from; and every
-- step since, each a sentence resting on a row that already holds the truth.
-- It is a thread through canonical objects, not a second record of them:
-- spend stays in the spend ledgers, acts in proposed_acts, effects in their
-- receipts, tests in venture_experiments. A step REFERENCES; it does not
-- restate. Opening one grants nothing.
-- =============================================================================

-- The verbs, as a vocabulary that grows by migration. Deliberately NOT
-- constitutional: these seven are the first families of owner intent, not
-- its ceiling — create, adopt, sell, retire, reposition, commission, migrate,
-- protect and kinds nobody has named yet are expected to follow.
CREATE TABLE undertaking_kinds (
  kind            TEXT PRIMARY KEY,
  in_owner_words  TEXT NOT NULL,
  what_it_means   TEXT NOT NULL,
  sort_order      INTEGER NOT NULL
);
INSERT INTO undertaking_kinds (kind, in_owner_words, what_it_means, sort_order) VALUES
  ('understand',  'learn what this is',   'read everything it can reach about the company, say what it can and cannot see, and ask for what would let it see more', 1),
  ('investigate', 'find out why',         'work from the readings to a cause it can stand behind, or say what would settle it', 2),
  ('grow',        'make it bigger',       'find where growth is being lost and bring the smallest thing that would change it', 3),
  ('fix',         'put it right',         'find what is broken, propose the act that repairs it, and wait for the yes', 4),
  ('test',        'put it to the world',  'turn a belief into one sealed prediction and the cheapest thing that could disprove it', 5),
  ('economise',   'spend less',           'find what is being spent here and which of it need not be', 6),
  ('handle',      'take care of it',      'carry whatever this needs within what he has allowed, and ask for the rest', 7);

CREATE TABLE undertakings (
  id               TEXT PRIMARY KEY,
  founder_id       TEXT NOT NULL REFERENCES founders(id),
  product_id       TEXT NOT NULL REFERENCES products(id),
  kind             TEXT NOT NULL REFERENCES undertaking_kinds(kind),
  -- His words, verbatim, or NULL when the institution opened this itself.
  asked            TEXT,
  -- What it was understood as: the sentence he saw before it bound.
  understood_as    TEXT NOT NULL,
  -- founder:<id> or institution:<reason>.
  opened_by        TEXT NOT NULL,
  -- Where it came from: his sentence, or a row of the institution's.
  opened_from_kind TEXT NOT NULL CHECK (opened_from_kind IN ('owner','situation','recommendation','candidate')),
  opened_from_id   TEXT,
  opened_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at        TEXT,
  closed_as        TEXT CHECK (closed_as IN ('done','dropped','superseded','nothing_to_do')),
  closed_because   TEXT,
  closed_by        TEXT,
  -- When closed as superseded, the undertaking that took its place.
  superseded_by    TEXT REFERENCES undertakings(id),
  evidence_mode    TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  CHECK ((closed_at IS NULL) = (closed_as IS NULL)),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CHECK ((closed_as = 'superseded') = (superseded_by IS NOT NULL))
);
CREATE INDEX idx_undertakings_open ON undertakings(product_id, closed_at);
CREATE INDEX idx_undertakings_founder ON undertakings(founder_id, closed_at);
-- ONE OPEN THREAD PER SENTENCE PER COMPANY. Pressing "yes" twice, or a slow
-- phone sending the confirmation again, cannot open the same work twice.
CREATE UNIQUE INDEX idx_undertakings_one_open_ask
  ON undertakings(product_id, asked) WHERE closed_at IS NULL AND asked IS NOT NULL;

-- An invented company's undertakings are invented. The mode is checked against
-- the company, not trusted from the caller.
CREATE TRIGGER undertakings_evidence_matches_reality
BEFORE INSERT ON undertakings
WHEN NEW.evidence_mode <> (SELECT reality FROM products WHERE id = NEW.product_id)
BEGIN SELECT RAISE(ABORT,'undertakings:evidence_mode_must_match_reality'); END;

-- Only an owner's company. The founder on the row must own the product.
CREATE TRIGGER undertakings_owner_owns_company
BEFORE INSERT ON undertakings
WHEN NEW.founder_id <> (SELECT owner_id FROM products WHERE id = NEW.product_id)
BEGIN SELECT RAISE(ABORT,'undertakings:founder_must_own_company'); END;

-- WHAT WAS ASKED IS WHAT WAS ASKED. His words, what they were understood as,
-- who opened it and for which company never change after the row exists.
CREATE TRIGGER undertakings_identity_immutable
BEFORE UPDATE OF founder_id, product_id, kind, asked, understood_as, opened_by,
  opened_from_kind, opened_from_id, opened_at, evidence_mode ON undertakings
BEGIN SELECT RAISE(ABORT,'undertakings:identity_is_immutable'); END;

-- Closing is one act, and it is final: reopening is a new undertaking that can
-- say it supersedes the old one.
CREATE TRIGGER undertakings_close_once
BEFORE UPDATE OF closed_at, closed_as, closed_by, closed_because, superseded_by ON undertakings
WHEN OLD.closed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'undertakings:already_closed'); END;

-- A successor is another undertaking for the same company, never itself.
CREATE TRIGGER undertakings_successor_is_same_company
BEFORE UPDATE OF superseded_by ON undertakings
WHEN NEW.superseded_by IS NOT NULL AND (
  NEW.superseded_by = NEW.id
  OR (SELECT product_id FROM undertakings WHERE id = NEW.superseded_by) IS NOT NEW.product_id)
BEGIN SELECT RAISE(ABORT,'undertakings:successor_must_be_same_company'); END;

CREATE TABLE undertaking_steps (
  id              TEXT PRIMARY KEY,
  undertaking_id  TEXT NOT NULL REFERENCES undertakings(id),
  -- Carried on the step so an erasure reaches it directly, as workspace_events
  -- does; the trigger below keeps it equal to the undertaking's.
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'looked','found','needs','asked_you','you_said','proposed',
                    'approved','refused','did','waiting_on_world','outcome','learned','closed')),
  -- One sentence, in his register. The truth it speaks of is in the row it references.
  said            TEXT NOT NULL,
  -- The row this step rests on, when there is one.
  ref_kind        TEXT CHECK (ref_kind IN (
                    'situation','recommendation','proposed_act','responsibility','candidate',
                    'experiment','workspace','sense','number','posture')),
  ref_id          TEXT,
  -- founder:<the undertaking's founder> or institution:<reader>. Nothing else.
  actor           TEXT NOT NULL,
  CHECK ((ref_kind IS NULL) = (ref_id IS NULL))
);
CREATE INDEX idx_undertaking_steps_thread ON undertaking_steps(undertaking_id, at);
-- ONE STEP PER FACT. The same act cannot be "approved" on the same thread
-- twice; a replayed decision is a no-op, not a second event.
CREATE UNIQUE INDEX idx_undertaking_steps_one_per_ref
  ON undertaking_steps(undertaking_id, kind, ref_kind, ref_id) WHERE ref_id IS NOT NULL;

-- A step belongs to whoever the undertaking belongs to.
CREATE TRIGGER undertaking_steps_founder_matches
BEFORE INSERT ON undertaking_steps
WHEN NEW.founder_id <> (SELECT founder_id FROM undertakings WHERE id = NEW.undertaking_id)
BEGIN SELECT RAISE(ABORT,'undertaking_steps:founder_must_match_undertaking'); END;

-- NOBODY ELSE'S NAME. A step is written by the owner of the thread or by the
-- institution; an actor claiming to be another founder is refused.
CREATE TRIGGER undertaking_steps_actor_is_real
BEFORE INSERT ON undertaking_steps
WHEN NOT (NEW.actor = 'founder:' || NEW.founder_id OR NEW.actor LIKE 'institution:%')
BEGIN SELECT RAISE(ABORT,'undertaking_steps:actor_must_be_owner_or_institution'); END;

-- A closed undertaking takes no more steps except the one that closes it.
CREATE TRIGGER undertaking_steps_not_after_close
BEFORE INSERT ON undertaking_steps
WHEN NEW.kind <> 'closed'
  AND (SELECT closed_at FROM undertakings WHERE id = NEW.undertaking_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'undertaking_steps:undertaking_is_closed'); END;

-- Steps are appended, never edited. (Deleted only by erasure.)
CREATE TRIGGER undertaking_steps_append_only
BEFORE UPDATE ON undertaking_steps
BEGIN SELECT RAISE(ABORT,'undertaking_steps:append_only'); END;

-- AN ACT BELONGS TO ONE THREAD, OR TO NONE. An act proposed within an
-- undertaking says so here; an act that merely shares the company with an
-- open thread is unrelated to it, and nothing will attach it. The thread must
-- be for the same company and still open.
ALTER TABLE proposed_acts ADD COLUMN undertaking_id TEXT REFERENCES undertakings(id);
CREATE TRIGGER proposed_acts_undertaking_is_same_company
BEFORE INSERT ON proposed_acts
WHEN NEW.undertaking_id IS NOT NULL AND (
  (SELECT product_id FROM undertakings WHERE id = NEW.undertaking_id) IS NOT NEW.product_id
  OR (SELECT closed_at FROM undertakings WHERE id = NEW.undertaking_id) IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'proposed_acts:undertaking_must_be_same_company_and_open'); END;
CREATE TRIGGER proposed_acts_undertaking_is_fixed
BEFORE UPDATE OF undertaking_id ON proposed_acts
BEGIN SELECT RAISE(ABORT,'proposed_acts:undertaking_is_fixed'); END;
