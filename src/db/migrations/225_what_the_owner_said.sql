-- =============================================================================
-- WHAT THE OWNER SAID
--
-- The owner's mandate: "Autonomy does not mean that the owner becomes unable to
-- participate... 'Do not change pricing without asking' should become a real
-- enforced standing boundary."
--
-- REAL AND ENFORCED IS THE WHOLE POINT. An institution that records an owner's
-- boundary and then merely consults it politely is worse than one that never
-- offered: he stops watching a thing he was told is held. So a boundary here is
-- refused at the same doors everything else consequential is refused at — the
-- outbound gateway's kill switch, and the spend gate — and nowhere else, for
-- the reason those are single doors in the first place.
--
-- TWO KINDS OF STANDING INTENT, AND THEY ARE GENUINELY DIFFERENT.
--
--   A BOUNDARY is prohibitive. "Do not contact anyone." It removes something
--   from what the institution may do, and it is enforced.
--
--   An OBJECTIVE is directional. "Retention matters more than acquisition right
--   now." It forbids nothing. It changes what is worth the owner's attention,
--   which is the scarcest thing the institution spends.
--
-- Storing them in one table with half the columns null for each would make the
-- difference a convention. They are two tables because they are two things.
--
-- ONE MODE, DELIBERATELY. The owner's sentence was "without asking", and the
-- obvious schema has `never` and `ask_first`. `ask_first` is not built, because
-- it cannot be honestly enforced today: nothing that reaches the outbound door
-- carries proof that the OWNER decided this particular act, so an `ask_first`
-- boundary would either refuse everything — making it a synonym for `never`
-- with a friendlier name — or trust a caller's word for an approval, which is
-- how a governance control becomes decoration. So there is one mode, it means
-- refused, and the owner can lift it in one tap. Widening the vocabulary is a
-- migration and a conversation, exactly as `governed_effect_kinds` intends.
-- =============================================================================

-- WHAT FOUNDRY COULD EVER DO TO A COMPANY, IN THE OWNER'S WORDS.
--
-- Constitutional and immutable, for the reason migration 136 made the effect
-- vocabulary immutable: a list of prohibitions that code can extend at runtime
-- is a list a compromised path can shrink.
--
-- `door` is where the subject is actually refused, and NULL is the honest
-- answer for most of them: Foundry has no way to change a price or deploy
-- anything today. A boundary on those is recorded, shown, and already true —
-- and it is waiting, wired, for the day a door exists. That is better than
-- refusing to record it, which would tell the owner his instruction was
-- ignored, and much better than implying an enforcement that is not there.
CREATE TABLE owner_boundary_subjects (
  subject       TEXT PRIMARY KEY,
  -- How it reads on the card where he decides. Completes "I will not ...".
  owner_words   TEXT NOT NULL,
  -- What is said at the moment of refusal, to whatever asked.
  refusal       TEXT NOT NULL,
  -- 'outbound' — the gateway kill switch. 'spend' — the model-spend gate.
  -- NULL — no path exists yet; nothing to refuse, and nothing pretended.
  door          TEXT CHECK (door IN ('outbound', 'spend')),
  sort_order    INTEGER NOT NULL
);

INSERT INTO owner_boundary_subjects (subject, owner_words, refusal, door, sort_order) VALUES
  ('contact_people', 'contact anyone',
   'the owner has told me not to contact anyone for this company', 'outbound', 1),
  ('spend_money', 'spend your money',
   'the owner has told me not to spend on this company', 'spend', 2),
  ('set_prices', 'change what a company charges',
   'the owner has told me not to change what this company charges', NULL, 3),
  ('move_money', 'move a company''s money — charges, refunds, payouts',
   'the owner has told me not to move this company''s money', NULL, 4),
  ('change_software', 'change a company''s code, product or infrastructure',
   'the owner has told me not to change this company''s software', NULL, 5),
  ('publish', 'say anything publicly in a company''s name',
   'the owner has told me not to publish anything for this company', NULL, 6),
  ('commit_on_my_behalf', 'promise anything to anyone on your behalf',
   'the owner has told me not to commit to anything for this company', NULL, 7);

CREATE TRIGGER owner_boundary_subjects_constitutional_insert
BEFORE INSERT ON owner_boundary_subjects
BEGIN SELECT RAISE(ABORT,'boundary_subject:constitutional'); END;
CREATE TRIGGER owner_boundary_subjects_constitutional_update
BEFORE UPDATE ON owner_boundary_subjects
BEGIN SELECT RAISE(ABORT,'boundary_subject:constitutional'); END;
CREATE TRIGGER owner_boundary_subjects_constitutional_delete
BEFORE DELETE ON owner_boundary_subjects
BEGIN SELECT RAISE(ABORT,'boundary_subject:constitutional'); END;

-- WHAT HE ACTUALLY SAID, AND WHAT IT BINDS.
--
-- `product_id` NULL means every company, present and future. That is not a
-- convenience: "do not spend anything" is a sentence an owner means about his
-- whole institution, and forcing him to repeat it per company would make the
-- instruction weaker every time he adds one.
--
-- `statement` is HIS WORDS, stored verbatim and never rewritten. The subject is
-- what the institution enforces; the statement is what he meant, and it is what
-- he is shown when he later asks why something was refused. An institution that
-- paraphrases the owner back to himself has lost the thread.
CREATE TABLE owner_boundaries (
  id             TEXT PRIMARY KEY,
  product_id     TEXT REFERENCES products(id),
  subject        TEXT NOT NULL REFERENCES owner_boundary_subjects(subject),
  statement      TEXT NOT NULL,
  set_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lifted_at      TEXT,
  lifted_reason  TEXT
);

CREATE TRIGGER owner_boundary_needs_words
BEFORE INSERT ON owner_boundaries
BEGIN
  SELECT RAISE(ABORT,'owner_boundary:statement_required')
    WHERE trim(NEW.statement) = '';
  -- A boundary arrives already lifted only by mistake.
  SELECT RAISE(ABORT,'owner_boundary:cannot_arrive_lifted')
    WHERE NEW.lifted_at IS NOT NULL;
END;

-- LIFTING IS AN OWNER ACT AND IT IS FINAL FOR THAT ROW.
--
-- A lifted boundary cannot be re-armed in place, for the reason a responsibility
-- cannot be moved between companies: the record would then say a boundary was
-- in force during a period when it was not. Setting it again writes a new row,
-- and the history stays true.
CREATE TRIGGER owner_boundary_lift_is_one_way
BEFORE UPDATE ON owner_boundaries
BEGIN
  SELECT RAISE(ABORT,'owner_boundary:already_lifted')
    WHERE OLD.lifted_at IS NOT NULL;
  SELECT RAISE(ABORT,'owner_boundary:lift_needs_reason')
    WHERE NEW.lifted_at IS NOT NULL AND trim(coalesce(NEW.lifted_reason,'')) = '';
  -- Only lifting may be edited. The subject and the words he used are what the
  -- record is for.
  SELECT RAISE(ABORT,'owner_boundary:immutable')
    WHERE NEW.subject IS NOT OLD.subject
       OR NEW.statement IS NOT OLD.statement
       OR NEW.product_id IS NOT OLD.product_id
       OR NEW.set_at IS NOT OLD.set_at;
END;

CREATE TRIGGER owner_boundary_no_delete
BEFORE DELETE ON owner_boundaries
BEGIN
  SELECT RAISE(ABORT,'owner_boundary:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE INDEX idx_owner_boundaries_live
  ON owner_boundaries(subject, product_id) WHERE lifted_at IS NULL;

-- WHAT HE IS TRYING TO DO, WHICH FORBIDS NOTHING.
--
-- This is not an OKR. `company_okrs` is a quarterly system with key results,
-- progress percentages and agent owners, and writing "retention matters more
-- than acquisition right now" into it invents a period, a status and a
-- progress figure the owner never stated — four facts fabricated to store one.
--
-- `focus_json` is the derived part: which of the company's numbers this points
-- at, so the institution can tell what is worth interrupting him about. It may
-- be an empty array, and that is a real answer — the objective is recorded and
-- everything stays equally watched, which is honest rather than a guess.
CREATE TABLE owner_objectives (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  statement       TEXT NOT NULL,
  focus_json      TEXT NOT NULL DEFAULT '[]',
  set_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at      TEXT,
  retired_reason  TEXT
);

CREATE TRIGGER owner_objective_needs_words
BEFORE INSERT ON owner_objectives
BEGIN
  SELECT RAISE(ABORT,'owner_objective:statement_required')
    WHERE trim(NEW.statement) = '';
  SELECT RAISE(ABORT,'owner_objective:focus_invalid')
    WHERE json_valid(NEW.focus_json) = 0 OR json_type(NEW.focus_json) <> 'array';
  SELECT RAISE(ABORT,'owner_objective:cannot_arrive_retired')
    WHERE NEW.retired_at IS NOT NULL;
END;

-- ONE LIVE OBJECTIVE PER COMPANY. A company being steered two ways at once is
-- not steered; it is an argument the institution would have to resolve on the
-- owner's behalf, which is precisely the judgement that is his.
CREATE UNIQUE INDEX idx_owner_objective_one_live
  ON owner_objectives(product_id) WHERE retired_at IS NULL;

CREATE TRIGGER owner_objective_retire_is_one_way
BEFORE UPDATE ON owner_objectives
BEGIN
  SELECT RAISE(ABORT,'owner_objective:already_retired')
    WHERE OLD.retired_at IS NOT NULL;
  SELECT RAISE(ABORT,'owner_objective:immutable')
    WHERE NEW.statement IS NOT OLD.statement
       OR NEW.product_id IS NOT OLD.product_id
       OR NEW.set_at IS NOT OLD.set_at;
END;

CREATE TRIGGER owner_objective_no_delete
BEFORE DELETE ON owner_objectives
BEGIN
  SELECT RAISE(ABORT,'owner_objective:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;
