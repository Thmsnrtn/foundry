-- A WORKSPACE EXISTING IS NOT WORK RUNNING IN IT.
--
-- `create_workspace` is "create an isolated computer for a piece of work", and
-- it is the only capability about workspaces there is. Nothing says a process
-- may EXECUTE inside one. So an adapter that could create a Sprite would have
-- closed the visible gap and left the real one: the institution would have had
-- an isolated computer and no capability describing work happening in it, and
-- the nearest thing that could run a step would still have been
-- `local_process` — on the machine Foundry itself runs on.
--
-- That is how the wrong abstraction gets established by a first provider. The
-- lifecycle and the execution are different capabilities with different
-- providers, and a substrate may implement one without the other:
-- `fly_machines` creates, checkpoints, restores and destroys, and its `run`
-- throws by design.

DROP TRIGGER capabilities_constitutional_insert;

INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('run_in_workspace', 'hosting',
   'run a process inside an isolated computer and read what it produced',
   'prepare', 141);

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

-- ─── WHAT A CAPABILITY IS CARRIED OUT THROUGH ──────────────────────────────
--
-- The mechanism that keeps a substrate's vocabulary out of the capabilities
-- above it. `write_code_in_branch` does not know what a Sprite is and must not
-- learn: it knows it is carried out by running a process in an isolated
-- workspace, and which computer that turns out to be is settled one layer down.
--
-- It also makes the dependency visible to anything asking what a piece of work
-- would take. A capability whose fulfilment route has no working provider is
-- unavailable however available it looks on its own row — which is exactly the
-- state `write_code_in_branch` was in while reporting 'available' through the
-- host.
CREATE TABLE capability_fulfilled_through (
  capability_key     TEXT PRIMARY KEY REFERENCES capabilities(capability_key),
  through_capability TEXT NOT NULL REFERENCES capabilities(capability_key),
  why                TEXT NOT NULL
);

INSERT INTO capability_fulfilled_through
  (capability_key, through_capability, why) VALUES
  ('write_code_in_branch', 'run_in_workspace',
   'a change to real software is produced by running generators, editors and '
   || 'tests somewhere the institution is not — the alternative is producing it '
   || 'on the machine the institution runs on'),
  ('run_in_workspace', 'create_workspace',
   'a process cannot run in a computer that does not exist yet');

CREATE TRIGGER capability_fulfilled_through_constitutional_insert
BEFORE INSERT ON capability_fulfilled_through
BEGIN SELECT RAISE(ABORT,'capability_fulfilled_through:constitutional'); END;
CREATE TRIGGER capability_fulfilled_through_constitutional_update
BEFORE UPDATE ON capability_fulfilled_through
BEGIN SELECT RAISE(ABORT,'capability_fulfilled_through:constitutional'); END;
CREATE TRIGGER capability_fulfilled_through_constitutional_delete
BEFORE DELETE ON capability_fulfilled_through
BEGIN SELECT RAISE(ABORT,'capability_fulfilled_through:constitutional'); END;

-- A CAPABILITY MAY NOT BE CARRIED OUT THROUGH ITSELF, directly or by a cycle
-- of two. A longer cycle would need a recursive check; two is what a hand-
-- written row plausibly gets wrong, and the table is constitutional so there
-- will not be many.
CREATE TRIGGER capability_fulfilled_through_is_not_circular
BEFORE INSERT ON capability_fulfilled_through
WHEN NEW.capability_key = NEW.through_capability
     OR EXISTS (SELECT 1 FROM capability_fulfilled_through f
                 WHERE f.capability_key = NEW.through_capability
                   AND f.through_capability = NEW.capability_key)
BEGIN SELECT RAISE(ABORT,'capability_fulfilled_through:circular'); END;
