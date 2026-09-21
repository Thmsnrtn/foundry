-- =============================================================================
-- A RECORD THAT OUTLIVES ITS KEEPER STILL ENDS WHEN HE DOES
--
-- Migration 334 made a published correction permanent, and permanent was too
-- strong by exactly one case. A third review cell found it: the BEFORE DELETE
-- trigger has no exemption for account erasure, and
-- `runFounderScopedErasure` issues a plain `DELETE FROM public_experiments
-- WHERE founder_id = ?` with no try/catch around it. So a founder who asks to
-- be erased gets an abort part-way through the sweep — every table ordered
-- after this one never cleared, the founders row never redacted, and retrying
-- futile because the trigger condition is permanent by design.
--
-- The file that runs that sweep documents this exact failure class already, in
-- a comment about a `DELETE FROM chat_sessions` that raised on a real company
-- and did not finish. The correction re-created it eight migrations later,
-- which is the argument for reading a repair as adversarially as the thing it
-- repairs.
--
-- AND THE SECOND HOLE IS THE ONE A BEFORE DELETE TRIGGER CANNOT SEE. SQLite
-- resolves `INSERT OR REPLACE` by deleting the conflicting row WITHOUT firing
-- BEFORE DELETE triggers, unless `recursive_triggers` is on — which nothing
-- here sets, and which is not a pragma to turn on globally to close one hole.
-- The reviewer verified it against this project's own client: DELETE blocked,
-- REPLACE succeeded, the clarification gone and every sealed column rewritten.
-- `INSERT OR REPLACE` is an ordinary idiom in this repository, so this is not
-- an exotic statement somebody would have to go looking for.
--
-- A rule that only watches DELETE is watching the door somebody is not using.
-- =============================================================================

DROP TRIGGER IF EXISTS public_experiment_is_not_deleted;

CREATE TRIGGER public_experiment_is_not_deleted
BEFORE DELETE ON public_experiments
BEGIN
  -- ERASURE IS THE ONE LEGITIMATE END. A published record is permanent against
  -- its keeper and not against the person it belongs to: an institution that
  -- could refuse to forget somebody because it had published a correction
  -- about them would have made its own bookkeeping into their problem. The
  -- exemption is the same one migration 331 uses for an outage's history, and
  -- it is narrow: an erasure has to be scheduled on one of this founder's own
  -- products before anything here may go.
  SELECT RAISE(ABORT,'public_experiment:a_published_record_is_not_deleted')
    WHERE (OLD.public_clarification IS NOT NULL
        OR EXISTS (SELECT 1 FROM public_publications p
                    WHERE p.experiment_id = OLD.experiment_id AND p.superseded_at IS NULL))
      AND NOT EXISTS (SELECT 1 FROM products p
                       WHERE p.owner_id = OLD.founder_id
                         AND p.erasure_scheduled_at IS NOT NULL);
END;

-- AND THE INSERT SIDE, because REPLACE arrives here rather than at the delete.
-- A row may not land on top of a record that carries a correction, whatever
-- conflict clause brought it. The three keys are checked separately because a
-- REPLACE may collide on any of them.
DROP TRIGGER IF EXISTS public_experiment_guard;

CREATE TRIGGER public_experiment_guard
BEFORE INSERT ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id);
  SELECT RAISE(ABORT,'public_experiment:slug_invalid')
    WHERE NEW.slug GLOB '*[^a-z0-9-]*' OR NEW.slug LIKE '-%' OR NEW.slug LIKE '%-' OR length(NEW.slug) < 3 OR length(NEW.slug) > 60;
  SELECT RAISE(ABORT,'public_experiment:number_invalid') WHERE NEW.number < 1;
  SELECT RAISE(ABORT,'public_experiment:copy_incomplete')
    WHERE trim(NEW.public_title) = '' OR trim(NEW.public_summary) = '' OR trim(NEW.public_who) = ''
       OR trim(NEW.public_what) = '' OR trim(NEW.public_limits) = '' OR trim(NEW.public_sources) = ''
       OR trim(NEW.public_selection) = '' OR trim(NEW.public_note) = '';
  SELECT RAISE(ABORT,'public_experiment:cannot_arrive_concluded') WHERE NEW.public_outcome IS NOT NULL OR NEW.graduated_to_url IS NOT NULL;
  SELECT RAISE(ABORT,'public_experiment:cannot_arrive_clarified')
    WHERE NEW.public_clarification IS NOT NULL OR NEW.public_clarification_at IS NOT NULL;

  -- THE DOOR REPLACE COMES THROUGH.
  SELECT RAISE(ABORT,'public_experiment:cannot_replace_a_clarified_record')
    WHERE EXISTS (SELECT 1 FROM public_experiments x
                   WHERE x.public_clarification IS NOT NULL
                     AND (x.experiment_id = NEW.experiment_id
                       OR (x.founder_id = NEW.founder_id AND x.slug = NEW.slug)
                       OR (x.founder_id = NEW.founder_id AND x.number = NEW.number)));

  SELECT RAISE(ABORT,'public_experiment:supersedes_unknown') WHERE NEW.supersedes_experiment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.supersedes_experiment_id AND e.founder_id = NEW.founder_id);
END;
