-- =============================================================================
-- THE FORGE DELIBERATES
--
-- Every real design so far was written by hand, and the owner asked not to be
-- the job. The forge now composes designs under a discipline stricter than a
-- person's: five disciplines read the record and each finding is written
-- BEFORE the design is composed; a separate adversary is given only the draft
-- and told to break it; and the rule that seals is neither of them.
--
-- Two ledgers hold that discipline where it cannot be skipped:
--
--   probe_lens_findings   what each discipline saw, on which rows, and what it
--                         recommends. A forge design with fewer than five
--                         behind it is refused at the row.
--   probe_attacks         what the adversary claimed, whether it became an
--                         amendment, and its verdict on running. Recorded only
--                         while the design is unsealed: an attack after the
--                         seal would be a way of rewriting the record.
--
-- Both are append-only, and both go with the person on erasure.
-- =============================================================================

CREATE TABLE probe_lens_findings (
  id             TEXT PRIMARY KEY,
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  lens           TEXT NOT NULL CHECK (lens IN
                   ('market_reality','experimental_design','commercial_operations',
                    'risk_ethics_compliance','economics_portfolio')),
  finding        TEXT NOT NULL,
  -- The addresses or record fields the finding rests on. A finding with none
  -- is an opinion and is not recorded.
  grounds_json   TEXT NOT NULL,
  risk           TEXT NOT NULL CHECK (risk IN ('low','material','high')),
  recommends     TEXT NOT NULL CHECK (recommends IN ('run','reframe','defer','kill')),
  because        TEXT NOT NULL,
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER probe_lens_finding_guard
BEFORE INSERT ON probe_lens_findings
BEGIN
  SELECT RAISE(ABORT,'probe_lens_finding:incomplete')
    WHERE trim(NEW.finding) = '' OR trim(NEW.because) = '' OR trim(NEW.recorded_by) = ''
       OR NEW.grounds_json IS NULL OR NEW.grounds_json IN ('', '[]');
  -- A finding is read before the design is composed, never after it is sealed.
  SELECT RAISE(ABORT,'probe_lens_finding:design_is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
END;

CREATE TRIGGER probe_lens_finding_append_only
BEFORE UPDATE ON probe_lens_findings
BEGIN SELECT RAISE(ABORT,'probe_lens_finding:append_only'); END;

CREATE TRIGGER probe_lens_finding_no_delete
BEFORE DELETE ON probe_lens_findings
BEGIN
  SELECT RAISE(ABORT,'probe_lens_finding:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

CREATE INDEX idx_probe_lens_findings_experiment ON probe_lens_findings(experiment_id, recorded_at);

CREATE TABLE probe_attacks (
  id             TEXT PRIMARY KEY,
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  claim          TEXT NOT NULL,
  why            TEXT NOT NULL,
  -- The design sentence attacked, when the attack offers a better one.
  field          TEXT,
  reads_now      TEXT,
  accepted       INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0,1)),
  verdict        TEXT NOT NULL CHECK (verdict IN ('run','reframe','defer','kill')),
  because        TEXT NOT NULL,
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER probe_attack_guard
BEFORE INSERT ON probe_attacks
BEGIN
  SELECT RAISE(ABORT,'probe_attack:incomplete')
    WHERE trim(NEW.claim) = '' OR trim(NEW.why) = '' OR trim(NEW.because) = '' OR trim(NEW.recorded_by) = '';
  SELECT RAISE(ABORT,'probe_attack:accepted_needs_a_sentence')
    WHERE NEW.accepted = 1 AND (NEW.field IS NULL OR NEW.reads_now IS NULL OR trim(NEW.reads_now) = '');
  -- THE ATTACKER IS NOT THE COMPOSER, and attacks a draft, not a record.
  SELECT RAISE(ABORT,'probe_attack:no_draft') WHERE NOT EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id);
  SELECT RAISE(ABORT,'probe_attack:design_is_sealed') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.sealed_at IS NOT NULL);
  SELECT RAISE(ABORT,'probe_attack:attacker_is_the_composer') WHERE EXISTS (
    SELECT 1 FROM probe_designs d WHERE d.experiment_id = NEW.experiment_id AND d.designed_by = NEW.recorded_by);
END;

CREATE TRIGGER probe_attack_append_only
BEFORE UPDATE ON probe_attacks
BEGIN SELECT RAISE(ABORT,'probe_attack:append_only'); END;

CREATE TRIGGER probe_attack_no_delete
BEFORE DELETE ON probe_attacks
BEGIN
  SELECT RAISE(ABORT,'probe_attack:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

CREATE INDEX idx_probe_attacks_experiment ON probe_attacks(experiment_id, recorded_at);

-- A FORGE DESIGN RESTS ON FIVE FINDINGS, at the row, so a composition that
-- skipped a discipline cannot be recorded as if it had not.
CREATE TRIGGER probe_design_forge_needs_five_lenses
BEFORE INSERT ON probe_designs
BEGIN
  SELECT RAISE(ABORT,'probe_design:forge_without_five_findings')
    WHERE NEW.designed_by = 'forge'
      AND (SELECT COUNT(DISTINCT lens) FROM probe_lens_findings f WHERE f.experiment_id = NEW.experiment_id) < 5;
END;
