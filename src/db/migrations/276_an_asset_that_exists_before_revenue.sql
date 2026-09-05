-- =============================================================================
-- AN ECONOMIC ASSET NEEDS A PRE-REVENUE EXISTENCE, AND MUST NOT BE MISTAKEN
-- FOR AN OPERATING COMPANY WHILE IT HAS ONE
--
-- THE TIMING CONFLICT THIS RESOLVES. Before a stranger can pay for anything,
-- the test needs an identity to act as, somewhere for an offer to live,
-- provider references, a budget, and artifacts. Before this migration the only
-- thing that could hold any of those was a company, and creating a company for
-- an idea is the confusion the venture mandate exists to prevent: idea = company.
-- The alternative — refusing the object any existence until revenue — would
-- leave the first payment with nothing to be paid TO.
--
-- So the portfolio unit stays the `products` row (it already carries free-text
-- `form`, `posture`, `reality`, a business actor and the money meter), and it
-- gains an EXISTENCE axis:
--
--   experimental   a test object. It carries lineage, form, identity, exposure
--                  references and the artifacts its test needs. It is NOT an
--                  operating company: no agents, no recurring company jobs, no
--                  ordinary model spend, no company count, no situation, no
--                  concentration, no external authority beyond its approved
--                  experiment.
--   earned         real economic evidence earned recognition that the object
--                  is a real economic asset rather than a hypothetical.
--
-- EARNED MEANS ONLY THAT. Not validated, not profitable, not durable, not worth
-- keeping, not broadly authorised. Every stronger claim is carried by the
-- reality and economic evidence that already exists. Owner judgment cannot
-- rewrite it: the owner may fund, continue or operate an unearned asset, and
-- the row still says experimental until the world says otherwise.
--
-- WHY A COLUMN AND NOT A STATUS VALUE. `products.status` is a column CHECK from
-- migration 001 and 135 foreign keys reference the table; widening a CHECK in
-- SQLite is a table rebuild, and a rebuild under 135 foreign keys is not a
-- change this institution makes to add a word. `reality` (222) and `posture`
-- (242) set the precedent: ADD COLUMN with its own CHECK and its own trigger.
--
-- WHY THE DEFAULT IS 'earned'. Every existing row is a company the owner
-- established or a reference company built to be watched. Reality earned AcreOS
-- and Foundry long before this column existed; a default of 'experimental'
-- would have demoted them to test objects by migration.
-- =============================================================================

ALTER TABLE products ADD COLUMN standing TEXT NOT NULL DEFAULT 'earned'
  CHECK (standing IN ('experimental','earned'));

-- WHETHER A SEPARATE OPERATING BOUNDARY EXISTS. A paid report is an asset; it is
-- not a company, has no entity, and should not be forced to pretend. A company
-- is attached only when one actually exists. Legacy rows are companies.
ALTER TABLE products ADD COLUMN operating_boundary TEXT NOT NULL DEFAULT 'company'
  CHECK (operating_boundary IN ('asset_only','company'));

-- LINEAGE. `from_opportunity_id` has existed since migration 259 and nothing
-- ever wrote it. The experiment is the link that was missing: an asset comes
-- from the test that earned it, and the test from the candidate, and the
-- candidate from a seed, a sentence somebody wrote, a brief and a mandate.
ALTER TABLE products ADD COLUMN from_experiment_id TEXT REFERENCES venture_experiments(id);

-- WHAT EARNED IT, WHEN, AND BY WHOSE RECORD. `earned_by` is the resolution that
-- settled the experiment by what actually happened, or an owner override that
-- says in words why he is calling it real without the world having done so.
ALTER TABLE products ADD COLUMN earned_at TEXT;
ALTER TABLE products ADD COLUMN earned_by TEXT;
ALTER TABLE products ADD COLUMN earned_because TEXT;

-- A ROW BORN EXPERIMENTAL MUST NAME ITS EXPERIMENT; A ROW BORN EARNED MUST NOT
-- CLAIM ONE IT DID NOT COME FROM. `earned_*` cannot arrive set: earning is a
-- transition, never a birth.
CREATE TRIGGER products_standing_birth
BEFORE INSERT ON products
BEGIN
  SELECT RAISE(ABORT,'products:experimental_needs_an_experiment')
    WHERE NEW.standing = 'experimental' AND NEW.from_experiment_id IS NULL;
  SELECT RAISE(ABORT,'products:cannot_arrive_earned_from_an_experiment')
    WHERE NEW.standing = 'earned' AND NEW.from_experiment_id IS NOT NULL;
  SELECT RAISE(ABORT,'products:earning_is_a_transition')
    WHERE NEW.earned_at IS NOT NULL OR NEW.earned_by IS NOT NULL
       OR NEW.earned_because IS NOT NULL;
  -- AN EXPERIMENT IN ONE WORLD CANNOT PRODUCE AN ASSET IN ANOTHER. A reference
  -- experiment may only produce a reference row; a real one a real row.
  SELECT RAISE(ABORT,'products:experiment_world_mismatch')
    WHERE NEW.from_experiment_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM venture_experiments e
         WHERE e.id = NEW.from_experiment_id
           AND e.decision = 'approved'
           AND ((e.evidence_mode = 'reference') = (NEW.reality = 'reference')));
  -- ONE ASSET PER EXPERIMENT. A test that produced two assets is two tests.
  SELECT RAISE(ABORT,'products:experiment_already_has_an_asset')
    WHERE NEW.from_experiment_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM products p
                   WHERE p.from_experiment_id = NEW.from_experiment_id
                     AND p.deleted_at IS NULL);
END;

-- EXPERIMENTAL → EARNED IS THE ONLY MOVE, AND REALITY MAKES IT.
--
-- The transition requires a prediction resolution for the asset's experiment
-- that was settled by a business outcome and came back as predicted or partly
-- — or an owner override with a reason, recorded as his and never as the
-- world's. Nothing moves back: an earned asset that fails later is retired,
-- repositioned or sold through the postures that already exist; it does not
-- become hypothetical again.
CREATE TRIGGER products_standing_transition
BEFORE UPDATE OF standing ON products
WHEN NEW.standing IS NOT OLD.standing
BEGIN
  SELECT RAISE(ABORT,'products:earned_cannot_become_experimental')
    WHERE OLD.standing = 'earned';
  SELECT RAISE(ABORT,'products:earning_needs_a_record')
    WHERE NEW.earned_at IS NULL OR trim(coalesce(NEW.earned_by,'')) = ''
       OR trim(coalesce(NEW.earned_because,'')) = '';
  SELECT RAISE(ABORT,'products:reality_has_not_earned_it')
    WHERE NEW.earned_by NOT LIKE 'founder:%'
      AND NOT EXISTS (
        SELECT 1 FROM prediction_resolutions r
         WHERE r.kind = 'venture_experiment'
           AND r.prediction_id = OLD.from_experiment_id
           AND r.resolved_by = 'business_outcome'
           AND r.verdict IN ('as_predicted','partly'));
END;

-- EARNING RECORDS ARE WRITTEN ONCE. The columns may be set only by the
-- transition above (they arrive NULL), and never changed afterwards.
CREATE TRIGGER products_earning_immutable
BEFORE UPDATE OF earned_at, earned_by, earned_because ON products
WHEN OLD.earned_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'products:earning_immutable');
END;

-- FROM_EXPERIMENT_ID IS SET AT BIRTH AND NEVER AFTER. Lineage that can be
-- attached later is lineage that can be changed later. `from_opportunity_id`
-- already has its own write-once guard (product_lineage:write_once, migration
-- 259), which lets an asset that never had a candidate be attributed by hand
-- exactly once; this guard owns only the experiment link and leaves that
-- behaviour alone.
CREATE TRIGGER products_experiment_lineage_immutable
BEFORE UPDATE OF from_experiment_id ON products
WHEN OLD.from_experiment_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'products:experiment_lineage_immutable');
END;

CREATE INDEX idx_products_standing ON products(standing);
CREATE INDEX idx_products_from_experiment ON products(from_experiment_id);

-- =============================================================================
-- AN EXPERIMENTAL ASSET IS STRUCTURALLY NOT AN OPERATING COMPANY.
--
-- The canonical predicate excludes it, and a gate will require every
-- enumeration of products to honour that predicate — but SELECTs cannot be
-- refused by the database. The WRITES that constitute ordinary operating
-- treatment can. Each of these names itself so the refusal reads as what it
-- is. Experiment-scoped work is the only exemption and is named in the act.
-- (Table list finalised from the writers sweep — see plan.)
-- =============================================================================
-- agent provisioning
CREATE TRIGGER agent_instances_not_for_experimental
BEFORE INSERT ON agent_instances
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND standing = 'experimental')
BEGIN SELECT RAISE(ABORT,'products:experimental_cannot_be_provisioned'); END;

-- a situation is a diagnosis of an operating company
CREATE TRIGGER company_situations_not_for_experimental
BEFORE INSERT ON company_situations
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND standing = 'experimental')
BEGIN SELECT RAISE(ABORT,'products:experimental_has_no_situation'); END;

-- a company-level exposure would count in concentration; the candidate's
-- exposures already do, on the opportunity, until the asset is earned
CREATE TRIGGER portfolio_exposures_not_for_experimental
BEFORE INSERT ON portfolio_exposures
WHEN NEW.subject_kind = 'company'
 AND EXISTS (SELECT 1 FROM products WHERE id = NEW.subject_id AND standing = 'experimental')
BEGIN SELECT RAISE(ABORT,'products:experimental_is_not_a_concentration'); END;

-- a responsibility is portfolio operating treatment
CREATE TRIGGER institutional_responsibilities_not_for_experimental
BEFORE INSERT ON institutional_responsibilities
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND standing = 'experimental')
BEGIN SELECT RAISE(ABORT,'products:experimental_carries_no_responsibility'); END;

-- ORDINARY MODEL SPEND BELONGS TO A COMPANY THAT OPERATES. An experimental
-- asset's test spends through its workshop budget and the founder scope, never
-- as "this company's AI cost": a reservation naming an experimental product is
-- exactly the accounting that would let a test object look like a business.
CREATE TRIGGER ai_spend_reservations_not_for_experimental
BEFORE INSERT ON ai_spend_reservations
WHEN NEW.product_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND standing = 'experimental')
BEGIN SELECT RAISE(ABORT,'products:experimental_has_no_company_spend'); END;

-- STANDING AUTHORITY IS FOR THINGS THAT EXIST. An experimental asset's only
-- authority is its approved experiment; a delegation on it would be authority
-- with nothing real behind it.
CREATE TRIGGER delegations_not_for_experimental
BEFORE INSERT ON delegations
WHEN NEW.product_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND standing = 'experimental')
BEGIN SELECT RAISE(ABORT,'products:experimental_holds_no_delegation'); END;

-- WHAT IS DELIBERATELY ALLOWED, so the next reader does not "fix" it: a
-- business actor (the offer needs a name to act as), a company sense (the
-- storefront needs watching), a proposed act (the test's execution steps),
-- money in the meter (bounded by the allowance the approval wrote), and the
-- allowance itself. Each of those is experiment-scoped by construction.

-- ─── WHY IT WAS RETIRED, ON THE ROW ──────────────────────────────────────────
-- A failed test archives its object; the reason travels with it, because "why
-- is this archived" is a question asked a year later by somebody who was not
-- there. Lineage is untouched by retirement.
ALTER TABLE products ADD COLUMN retired_because TEXT;
