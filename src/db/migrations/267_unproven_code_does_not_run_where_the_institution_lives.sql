-- UNPROVEN CODE DOES NOT RUN WHERE THE INSTITUTION LIVES.
--
-- The host boundary said: code Foundry did not write may not run on the trusted
-- host. That is the right instinct and the wrong test. Code is not trustworthy
-- because Foundry authored it — a change this institution generates for its own
-- software has been run by nobody, verified by nothing, and is exactly as
-- capable of destroying the machine it runs on as anything else.
--
-- The stronger rule is about the code's STANDING, not its authorship:
-- generated, modified, unfamiliar or otherwise unproven code executes in an
-- isolated workspace, never inside the trusted institutional core. The
-- institution orchestrates and judges. The workshop experiments.
--
-- WHAT THIS FOUND. `write_code_in_branch` is 'available' through
-- `local_process`, and `workspace_substrates` records that substrate's
-- isolation as `same_host` — "a real directory and real commands, on the
-- machine Foundry itself runs on". So the institution believed it could produce
-- changes to its own software on the machine it is running on. That belief was
-- never acted on, and it would have been the first thing acted on the moment
-- the schema-drift responsibility found a hand.

CREATE TABLE change_production_isolation (
  -- Checked rather than referenced: `workspace_substrates` is keyed on the
  -- substrate, so a foreign key to its isolation column is a mismatch. The
  -- vocabulary is that column's, and this table says what each value permits.
  isolation   TEXT PRIMARY KEY CHECK (isolation IN
                ('executes_nothing','same_host','isolated')),
  may_produce INTEGER NOT NULL,
  why         TEXT NOT NULL
);

INSERT INTO change_production_isolation (isolation, may_produce, why) VALUES
  ('executes_nothing', 0,
   'it runs nothing, so a change produced in it was never actually produced'),
  ('same_host', 0,
   'a change that has been run by nobody and verified by nothing would be '
   || 'executing on the machine the institution itself depends on'),
  ('isolated', 1,
   'the work happens somewhere the institution is not, so being wrong costs a '
   || 'workspace rather than the institution');

CREATE TRIGGER change_production_isolation_constitutional_insert
BEFORE INSERT ON change_production_isolation
BEGIN SELECT RAISE(ABORT,'change_production_isolation:constitutional'); END;
CREATE TRIGGER change_production_isolation_constitutional_update
BEFORE UPDATE ON change_production_isolation
BEGIN SELECT RAISE(ABORT,'change_production_isolation:constitutional'); END;
CREATE TRIGGER change_production_isolation_constitutional_delete
BEFORE DELETE ON change_production_isolation
BEGIN SELECT RAISE(ABORT,'change_production_isolation:constitutional'); END;

-- ─── WHAT THE INSTITUTION LEARNED BY LOOKING FOR A HAND ────────────────────
--
-- Recorded as evidence rather than as a plan. The schema-drift responsibility
-- is real and recurring; the search for a hand to carry it produced a precise
-- account of which layer is missing, and the layers were already separate in
-- the constitutional vocabulary rather than needing to be invented:
--
--   read_repository       github          available
--   create_workspace      fly_machines    declared   <- run() throws by design
--   create_workspace      fly_sprites     declared   <- no adapter at all
--   write_code_in_branch  local_process   available  <- same_host, now refused
--   open_pull_request     github          available
--   merge_to_main         —               none       <- and stays that way
--
-- Exactly one link is missing: a workspace that is somewhere the institution is
-- not. Everything on either side of it already has a provider that works.
CREATE TABLE substrate_evaluations (
  id             TEXT PRIMARY KEY,
  substrate      TEXT NOT NULL,
  property       TEXT NOT NULL,
  finding        TEXT NOT NULL,
  -- Where this was read, so the evaluation can be checked rather than believed.
  source         TEXT NOT NULL,
  evaluated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_substrate_evaluations ON substrate_evaluations(substrate, property);
