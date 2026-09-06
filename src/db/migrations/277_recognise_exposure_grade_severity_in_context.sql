-- =============================================================================
-- RECOGNISE EXPOSURE PERMANENTLY; GRADE ITS SEVERITY IN CONTEXT; BIAS THE
-- FIRST PROOF BY POLICY THAT THE OWNER CAN SUPERSEDE
--
-- THE BLOCKER THIS REMOVES. `legalPictureOf` gates `advance`, and for a REAL
-- candidate nothing ever wrote a legal surface or answered whether the same
-- value could be created with less of one — only the reference world did. So
-- every real candidate read "nobody has asked what legal surface this
-- creates" forever, and could never move.
--
-- THREE THINGS, WITH THREE LIFETIMES:
--
--   exposure_floors        durable: structural facts that are inherently
--                          consequential wherever they occur. Changed only by
--                          migration. Deliberately short.
--   origination_policy     present policy: what the FIRST ECONOMIC CLOSURE
--                          proof refuses or penalises so the first proof is
--                          small. Founder-scoped, owner-supersedable, seeded
--                          with a `why` on every row saying it is a bias.
--   legal_surfaces.standing whether Foundry RECOGNISED an exposure or could
--                          not resolve internally whether it applies. Both are
--                          honest states; only the second is "I do not know".
--
-- WHAT THIS MUST NEVER DO: turn model confidence into legal certification.
-- The strongest positive sentence the pass can produce is "no currently
-- recognised material legal surface requires professional review". It must
-- also be able to say "I cannot resolve whether X applies from here", and
-- under the first-closure policy that sentence blocks like a serious one.
-- =============================================================================

-- ─── DURABLE FLOORS ──────────────────────────────────────────────────────────
CREATE TABLE exposure_floors (
  structural_fact    TEXT PRIMARY KEY,
  class              TEXT NOT NULL REFERENCES exposure_classes(class),
  min_severity       TEXT NOT NULL CHECK (min_severity IN ('minor','material','serious')),
  needs_professional INTEGER NOT NULL DEFAULT 0,
  why                TEXT NOT NULL,
  sort_order         INTEGER NOT NULL
);
INSERT INTO exposure_floors (structural_fact, class, min_severity, needs_professional, why, sort_order) VALUES
  ('custody_of_money', 'financial_activity', 'serious', 1,
   'holding or moving other people''s money is regulated everywhere it happens', 1),
  ('regulated_decision', 'regulation', 'serious', 1,
   'a regulator has rules about doing this at all', 2),
  ('professional_reliance', 'professional_reliance', 'serious', 1,
   'somebody would act on it as if a qualified person had said it', 3),
  ('decision_about_named_person', 'regulation', 'serious', 1,
   'employment, credit, housing and access decisions about a named person are never ordinary company effects', 4);
CREATE TRIGGER exposure_floors_constitutional_insert
BEFORE INSERT ON exposure_floors
BEGIN SELECT RAISE(ABORT,'exposure_floor:constitutional'); END;
CREATE TRIGGER exposure_floors_constitutional_update
BEFORE UPDATE ON exposure_floors
BEGIN SELECT RAISE(ABORT,'exposure_floor:constitutional'); END;
CREATE TRIGGER exposure_floors_constitutional_delete
BEFORE DELETE ON exposure_floors
BEGIN SELECT RAISE(ABORT,'exposure_floor:constitutional'); END;

-- ─── RECOGNISED IS NOT RESOLVED ──────────────────────────────────────────────
ALTER TABLE legal_surfaces ADD COLUMN standing TEXT NOT NULL DEFAULT 'recognised'
  CHECK (standing IN ('recognised','unresolved_internally'));
-- THE WORDS THAT DROVE THE RECOGNITION, copied from the record it was read
-- from. A recognition with no grounds is an opinion.
ALTER TABLE legal_surfaces ADD COLUMN grounds TEXT;
-- Who or what recognised it: 'reference_world', 'legal_pass:sonnet', a person.
ALTER TABLE legal_surfaces ADD COLUMN recognised_by TEXT;

-- ─── THE PRESENT POLICY, OWNER-SUPERSEDABLE ──────────────────────────────────
-- A founder_id of NULL is the institutional default. A founder's own row for
-- the same requirement, not superseded, overrides it. Superseding is one owner
-- act and removes the requirement from every card that reads it.
CREATE TABLE origination_policy (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT REFERENCES founders(id),
  requirement    TEXT NOT NULL,
  -- refuse: blocks placing an offer under this profile. penalise: shown, and
  -- weighs against, never blocks. prefer: shown as a preference. require: must
  -- be satisfied. policy: a number the tick reads (value column).
  treatment      TEXT NOT NULL CHECK (treatment IN ('refuse','penalise','prefer','require','policy')),
  value          TEXT,
  why            TEXT NOT NULL,
  set_by         TEXT NOT NULL,
  set_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at  TEXT,
  superseded_by  TEXT
);
CREATE INDEX idx_origination_policy_live
  ON origination_policy(founder_id, requirement, superseded_at);
CREATE TRIGGER origination_policy_guard
BEFORE INSERT ON origination_policy
BEGIN
  SELECT RAISE(ABORT,'origination_policy:incomplete')
    WHERE trim(NEW.requirement) = '' OR trim(NEW.why) = '' OR trim(NEW.set_by) = '';
  SELECT RAISE(ABORT,'origination_policy:cannot_arrive_superseded')
    WHERE NEW.superseded_at IS NOT NULL;
  -- A FOUNDER ROW IS THE OWNER'S. The institution seeds defaults with no
  -- founder; only a person writes a row that overrides them.
  SELECT RAISE(ABORT,'origination_policy:founder_row_is_the_owners')
    WHERE NEW.founder_id IS NOT NULL AND NEW.set_by NOT LIKE 'founder:%';
END;
CREATE TRIGGER origination_policy_supersede_only
BEFORE UPDATE ON origination_policy
BEGIN
  SELECT RAISE(ABORT,'origination_policy:immutable_except_supersession')
    WHERE NEW.requirement IS NOT OLD.requirement OR NEW.treatment IS NOT OLD.treatment
       OR NEW.value IS NOT OLD.value OR NEW.why IS NOT OLD.why
       OR NEW.set_by IS NOT OLD.set_by OR NEW.founder_id IS NOT OLD.founder_id;
  SELECT RAISE(ABORT,'origination_policy:already_superseded')
    WHERE OLD.superseded_at IS NOT NULL;
  SELECT RAISE(ABORT,'origination_policy:supersession_needs_a_person')
    WHERE NEW.superseded_at IS NOT NULL AND coalesce(NEW.superseded_by,'') NOT LIKE 'founder:%';
END;

INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by) VALUES
  ('fec_no_recurring_billing', NULL, 'no_recurring_billing', 'refuse', NULL,
   'first proof: a subscription creates an ongoing consumer obligation and a support surface; one-visit payment does not', 'proof_program:first_economic_closure'),
  ('fec_no_persistent_personal_data', NULL, 'no_persistent_personal_data', 'refuse', NULL,
   'first proof: holding people''s data is a privacy surface the test does not need', 'proof_program:first_economic_closure'),
  ('fec_no_cross_border_selling', NULL, 'no_cross_border_selling', 'penalise', NULL,
   'first proof: tax and consumer rules multiply per geography, and are unknown until the offer says where it sells', 'proof_program:first_economic_closure'),
  ('fec_no_support_obligation', NULL, 'no_support_obligation', 'refuse', NULL,
   'first proof: a support queue is a flat attention curve', 'proof_program:first_economic_closure'),
  ('fec_no_manual_fulfilment', NULL, 'no_manual_fulfilment', 'refuse', NULL,
   'first proof: fulfilment by hand is owner minutes per sale', 'proof_program:first_economic_closure'),
  ('fec_no_user_generated_content', NULL, 'no_user_generated_content', 'refuse', NULL,
   'first proof: other people''s words under the asset''s name is a moderation surface', 'proof_program:first_economic_closure'),
  ('fec_no_account_system', NULL, 'no_account_system', 'refuse', NULL,
   'first proof: accounts mean credentials, resets, retention and deletion obligations', 'proof_program:first_economic_closure'),
  ('fec_no_two_sided_marketplace', NULL, 'no_two_sided_marketplace', 'refuse', NULL,
   'first proof: two audiences to acquire and to police', 'proof_program:first_economic_closure'),
  ('fec_one_visit_delivery', NULL, 'one_visit_delivery', 'prefer', NULL,
   'arrive, understand, pay, receive is the lightest flow that closes value, payment and delivery', 'proof_program:first_economic_closure'),
  ('fec_front_loaded_attention', NULL, 'front_loaded_attention', 'require', NULL,
   'owner minutes spent once at birth, never weekly (objective, threshold thesis)', 'proof_program:first_economic_closure'),
  ('fec_block_on_unresolved_material', NULL, 'block_on_unresolved_material_uncertainty', 'require', NULL,
   'first proof: an exposure Foundry cannot resolve internally blocks exactly as a recognised serious one does', 'proof_program:first_economic_closure'),
  ('fec_failed_test_grace_days', NULL, 'failed_test_grace_days', 'policy', '30',
   'an experimental asset whose valid test failed archives after this many days with no narrowed rerun approved; a present choice, not law', 'proof_program:first_economic_closure');

-- ─── WHAT AN OFFER ACTUALLY IS, ONCE IT IS CONCRETE ──────────────────────────
-- A candidate-level legal read cannot settle facts that do not exist yet. The
-- six facts below are what severity depends on, and they exist only when a
-- test has a shape. Written by the future hand (and the reference world now);
-- the asset-level pass re-runs whenever a row here changes.
CREATE TABLE offer_shapes (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  sells          TEXT NOT NULL,        -- what is actually sold
  claims_made    TEXT NOT NULL,        -- what it says about itself and its results
  collects       TEXT NOT NULL,        -- what data is collected, or 'nothing'
  delivers_by    TEXT NOT NULL,        -- how value reaches the buyer
  sells_to       TEXT NOT NULL,        -- where customers are, as far as known
  charges_how    TEXT NOT NULL,        -- one-off, metered, subscription, free
  stated_by      TEXT NOT NULL,
  stated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at  TEXT
);
CREATE UNIQUE INDEX idx_offer_shape_live ON offer_shapes(experiment_id) WHERE superseded_at IS NULL;
CREATE TRIGGER offer_shape_guard
BEFORE INSERT ON offer_shapes
BEGIN
  SELECT RAISE(ABORT,'offer_shape:incomplete')
    WHERE trim(NEW.sells) = '' OR trim(NEW.claims_made) = '' OR trim(NEW.collects) = ''
       OR trim(NEW.delivers_by) = '' OR trim(NEW.sells_to) = '' OR trim(NEW.charges_how) = ''
       OR trim(NEW.stated_by) = '';
  SELECT RAISE(ABORT,'offer_shape:asset_mismatch')
    WHERE NOT EXISTS (SELECT 1 FROM products p
                       WHERE p.id = NEW.product_id AND p.from_experiment_id = NEW.experiment_id);
END;

-- ─── THE STRUCTURAL FACTS SEVERITY DEPENDS ON ────────────────────────────────
-- A closed vocabulary of the facts about an offer that decide how serious an
-- exposure is and whether a first-proof policy applies. Constitutional: the
-- list is a claim about what matters, not something the pass may extend to
-- suit a candidate. Each names the policy requirement it answers, so the
-- policy table and the recognition pass cannot drift apart about meaning.
CREATE TABLE structural_fact_kinds (
  fact                TEXT PRIMARY KEY,
  what_it_is          TEXT NOT NULL,
  -- The origination_policy requirement this fact answers, and what value of
  -- the fact SATISFIES it. NULL where no policy asks.
  answers_requirement TEXT,
  satisfied_when      INTEGER,
  sort_order          INTEGER NOT NULL
);
INSERT INTO structural_fact_kinds (fact, what_it_is, answers_requirement, satisfied_when, sort_order) VALUES
  ('custody_of_money',            'it would hold or move money that belongs to somebody else',        NULL, NULL, 1),
  ('regulated_decision',          'a regulator has rules about doing this at all',                    NULL, NULL, 2),
  ('professional_reliance',       'a buyer would act on it as if a qualified person had said it',      NULL, NULL, 3),
  ('decision_about_named_person', 'it would decide something about a named person',                   NULL, NULL, 4),
  ('recurring_billing',           'it charges on a schedule rather than once',                        'no_recurring_billing', 0, 5),
  ('persistent_personal_data',    'it keeps personal information about people after the visit',       'no_persistent_personal_data', 0, 6),
  ('cross_border_selling',        'it sells to people in more than one country',                      'no_cross_border_selling', 0, 7),
  ('support_obligation',          'a buyer would reasonably expect ongoing help',                     'no_support_obligation', 0, 8),
  ('manual_fulfilment',           'somebody has to do something by hand for each sale',               'no_manual_fulfilment', 0, 9),
  ('user_generated_content',      'it publishes other people''s words or images under its own name',  'no_user_generated_content', 0, 10),
  ('account_system',              'a buyer has to create and keep an account',                        'no_account_system', 0, 11),
  ('two_sided_marketplace',       'it needs two different audiences to show up',                      'no_two_sided_marketplace', 0, 12),
  ('one_visit_delivery',          'a buyer can arrive, understand, pay and receive in one visit',     'one_visit_delivery', 1, 13),
  ('front_loaded_attention',      'the owner''s non-delegable work is spent once, at birth',          'front_loaded_attention', 1, 14);
CREATE TRIGGER structural_fact_kinds_constitutional_insert
BEFORE INSERT ON structural_fact_kinds
BEGIN SELECT RAISE(ABORT,'structural_fact_kind:constitutional'); END;
CREATE TRIGGER structural_fact_kinds_constitutional_update
BEFORE UPDATE ON structural_fact_kinds
BEGIN SELECT RAISE(ABORT,'structural_fact_kind:constitutional'); END;
CREATE TRIGGER structural_fact_kinds_constitutional_delete
BEFORE DELETE ON structural_fact_kinds
BEGIN SELECT RAISE(ABORT,'structural_fact_kind:constitutional'); END;

-- WHAT WAS ESTABLISHED ABOUT A PARTICULAR CANDIDATE OR ASSET. `present` NULL
-- means UNKNOWN, and unknown is a real answer: at candidate level most of
-- these cannot be known because the offer has no shape yet, and the pass must
-- say so rather than guess. `basis` says where the answer came from.
CREATE TABLE structural_facts (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('company','opportunity')),
  subject_id     TEXT NOT NULL,
  fact           TEXT NOT NULL REFERENCES structural_fact_kinds(fact),
  present        INTEGER CHECK (present IN (0,1)),
  basis          TEXT NOT NULL CHECK (basis IN ('stated','assumed_by_lighter','offer_shape','unknown')),
  -- The words the answer rests on, copied from the record it was read from.
  grounds        TEXT,
  recognised_by  TEXT NOT NULL,
  evidence_mode  TEXT NOT NULL CHECK (evidence_mode IN ('real','reference')),
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at  TEXT
);
CREATE UNIQUE INDEX idx_structural_fact_live
  ON structural_facts(subject_kind, subject_id, fact) WHERE superseded_at IS NULL;
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
END;
CREATE TRIGGER structural_fact_supersede_only
BEFORE UPDATE ON structural_facts
BEGIN
  SELECT RAISE(ABORT,'structural_fact:immutable_except_supersession')
    WHERE NEW.present IS NOT OLD.present OR NEW.basis IS NOT OLD.basis
       OR NEW.grounds IS NOT OLD.grounds OR NEW.fact IS NOT OLD.fact;
END;
