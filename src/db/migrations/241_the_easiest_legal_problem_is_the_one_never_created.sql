-- =============================================================================
-- THE EASIEST LEGAL PROBLEM IS THE ONE NEVER CREATED
--
-- The owner made legal, regulatory and liability exposure a first-class
-- portfolio constraint - not "avoid every business containing risk", but:
-- prefer the structurally lighter way of producing the same value, see the
-- heavy ones early, never let several assets share one legal failure, and know
-- when a question has left what Foundry can responsibly answer.
--
-- FOUNDRY IS NOT A LAWYER BECAUSE A MODEL CAN DISCUSS LAW. So nothing here is a
-- legal opinion and there is no score. What is kept is what an institution can
-- honestly keep: which KIND of exposure a thing creates, in what it consists,
-- what is known and unknown about it, what it assumes, how serious it looks,
-- when that was last true, and whether a qualified person has to look before
-- anything advances on it.
--
-- THE CLASSES ARE CONSTITUTIONAL; the surfaces are not. Adding a kind of
-- liability the institution can notice is a migration and a conversation. The
-- `often_avoided_by` column is the part that makes this a design discipline
-- rather than a filing system: for every class there is a way of building
-- that does not create it, and the candidate discipline asks that question
-- before it asks anything else.
-- =============================================================================

CREATE TABLE exposure_classes (
  class            TEXT PRIMARY KEY,
  -- What it is, in the owner's words.
  what_it_is       TEXT NOT NULL,
  -- The structural way of not having it, when one exists.
  often_avoided_by TEXT NOT NULL,
  sort_order       INTEGER NOT NULL
);

INSERT INTO exposure_classes (class, what_it_is, often_avoided_by, sort_order) VALUES
  ('regulation', 'a regulator has rules about doing this at all',
   'staying outside the regulated step, or leaving it to somebody licensed for it', 1),
  ('privacy_data', 'holding personal information about people',
   'not collecting it, not keeping it, or keeping only what the job needs', 2),
  ('professional_reliance', 'somebody acting on it as if a professional had said it',
   'giving the facts and leaving the judgement to a qualified person', 3),
  ('financial_activity', 'holding, moving or advising about money',
   'never taking custody - letting a payment provider carry the money', 4),
  ('consumer_protection', 'rules about how ordinary people may be sold to and billed',
   'plain pricing, easy cancellation, no surprise renewals', 5),
  ('intellectual_property', 'using something somebody else may own',
   'public or properly licensed inputs, and original output', 6),
  ('licensing', 'terms attached to data, code or content it depends on',
   'reading the terms before depending on the thing', 7),
  ('contractual', 'promises made to customers, suppliers or partners',
   'promising less, in writing, and only what can be kept', 8),
  ('cyber_security', 'being worth breaking into, and what leaks if it happens',
   'holding nothing worth stealing', 9),
  ('platform_policy', 'a platform whose rules can change or remove it',
   'not depending on one platform, or depending on it for less', 10),
  ('content_moderation', 'other people''s words or images published under its name',
   'no user-generated content, or none that is public', 11),
  ('employment', 'people who might count as employees',
   'no people, or clearly-defined contractors', 12),
  ('tax_geography', 'where it sells from and to, and what that obliges',
   'selling through a merchant of record, or in fewer places', 13),
  ('accessibility', 'obligations about who must be able to use it',
   'building it accessibly from the start, which is cheaper anyway', 14),
  ('claims_advertising', 'what it says about itself and its results',
   'claiming only what has been measured', 15),
  ('marketplace_rules', 'a marketplace whose rules govern how it may be listed and sold',
   'reading the rules before building for the marketplace', 16);

CREATE TRIGGER exposure_classes_constitutional_insert
BEFORE INSERT ON exposure_classes
BEGIN SELECT RAISE(ABORT,'exposure_class:constitutional'); END;
CREATE TRIGGER exposure_classes_constitutional_update
BEFORE UPDATE ON exposure_classes
BEGIN SELECT RAISE(ABORT,'exposure_class:constitutional'); END;
CREATE TRIGGER exposure_classes_constitutional_delete
BEFORE DELETE ON exposure_classes
BEGIN SELECT RAISE(ABORT,'exposure_class:constitutional'); END;

-- ONE KIND OF EXPOSURE ONE THING CREATES, AND WHAT IS KNOWN ABOUT IT.
CREATE TABLE legal_surfaces (
  id                 TEXT PRIMARY KEY,
  founder_id         TEXT NOT NULL REFERENCES founders(id),
  subject_kind       TEXT NOT NULL CHECK (subject_kind IN ('company','opportunity')),
  subject_id         TEXT NOT NULL,
  class              TEXT NOT NULL REFERENCES exposure_classes(class),
  -- In what the exposure consists, for this thing in particular.
  what_it_creates    TEXT NOT NULL,
  known              TEXT,
  unknown            TEXT,
  assumes            TEXT,
  -- HOW SERIOUS IT LOOKS, IN THREE WORDS RATHER THAN A NUMBER. The owner was
  -- explicit that a score would be theatre; three words a person can argue
  -- with are not.
  severity           TEXT NOT NULL CHECK (severity IN ('minor','material','serious')),
  -- Whether this has left what Foundry can responsibly answer.
  needs_professional INTEGER NOT NULL DEFAULT 0,
  -- WHEN THIS WAS LAST TRUE. Law and policy move, and an exposure recorded a
  -- year ago is evidence about last year.
  observed_at        TEXT NOT NULL,
  recorded_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_mode      TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  retired_at         TEXT
);

CREATE UNIQUE INDEX idx_legal_surface_one_live
  ON legal_surfaces(subject_kind, subject_id, class) WHERE retired_at IS NULL;

CREATE TRIGGER legal_surface_guard
BEFORE INSERT ON legal_surfaces
BEGIN
  SELECT RAISE(ABORT,'legal_surface:incomplete')
    WHERE trim(NEW.subject_id) = '' OR trim(NEW.what_it_creates) = '';
  SELECT RAISE(ABORT,'legal_surface:cannot_arrive_retired')
    WHERE NEW.retired_at IS NOT NULL;
  -- A SERIOUS EXPOSURE NOBODY QUALIFIED HAS LOOKED AT is exactly the state
  -- this exists to make visible. It may be recorded - that is the point - but
  -- it may not be recorded as if the question were closed.
  SELECT RAISE(ABORT,'legal_surface:serious_needs_a_professional_or_a_reason')
    WHERE NEW.severity = 'serious' AND NEW.needs_professional = 0
      AND trim(coalesce(NEW.known,'')) = '';
  SELECT RAISE(ABORT,'legal_surface:evidence_mode_mismatch')
    WHERE NEW.subject_kind = 'company'
      AND (NEW.evidence_mode = 'reference') <> EXISTS (
        SELECT 1 FROM products WHERE id = NEW.subject_id AND reality = 'reference');
  SELECT RAISE(ABORT,'legal_surface:evidence_mode_mismatch')
    WHERE NEW.subject_kind = 'opportunity'
      AND NOT EXISTS (SELECT 1 FROM venture_opportunities
                       WHERE id = NEW.subject_id AND evidence_mode = NEW.evidence_mode);
END;

CREATE TRIGGER legal_surface_retire_is_one_way
BEFORE UPDATE ON legal_surfaces
BEGIN
  SELECT RAISE(ABORT,'legal_surface:already_retired') WHERE OLD.retired_at IS NOT NULL;
  SELECT RAISE(ABORT,'legal_surface:immutable')
    WHERE NEW.subject_id IS NOT OLD.subject_id OR NEW.class IS NOT OLD.class
       OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.evidence_mode IS NOT OLD.evidence_mode;
END;

CREATE INDEX idx_legal_surfaces_live
  ON legal_surfaces(founder_id, class) WHERE retired_at IS NULL;

-- CAN THE SAME VALUE BE CREATED WITH LESS LEGAL SURFACE?
--
-- Asked of every candidate, and the answer kept: a lighter way of building it,
-- or the reason there is none. NULL means nobody has asked yet, and a
-- candidate nobody has asked that of does not advance.
ALTER TABLE venture_opportunities ADD COLUMN lighter_architecture TEXT;
