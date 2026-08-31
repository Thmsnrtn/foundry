-- =============================================================================
-- A COMPANY WHOSE LOOPS STOPPED, IN A TICK THAT SUCCEEDED
--
-- `job_health` answers "is Foundry's scheduled work running", and it is keyed
-- by job name alone — deliberately, and the erasure classifier says so: "job
-- names and error class names, no company in it."
--
-- The institution's two loops run per company, and each company's slice is
-- wrapped so that "one product's institutional state must never stop another's
-- pass." Those handlers log and continue, so the JOB succeeds. A company whose
-- judgment pass throws on every run therefore has `job_health` healthy,
-- `loopsStopped` zero, and the "Part of me has stopped" card never rendered —
-- while the loops that were supposed to be operating it did nothing for weeks.
--
-- That is the exact defect the card exists for. `every-gate-runs.test.ts` names
-- it: "a week in which the institution's loops threw on every run looked
-- exactly like a calm week on the page the founder reads." Fixed once at the
-- job level, still true one level down.
--
-- SAME SHAPE AS `job_health`, PER COMPANY. Consecutive failures rather than a
-- lifetime total, because the founder's question is "is this failing now" and a
-- total never answers it. An error CLASS only, never a message, guarded here as
-- migration 172 guards it there: a name is one identifier, and anything longer
-- is somebody putting a message where the name goes.
--
-- Carries `product_id`, so the by-product erasure sweep — which discovers
-- tables by that column rather than by a list — reaches it without being told.
-- =============================================================================

CREATE TABLE IF NOT EXISTS company_loop_health (
  product_id           TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  job_name             TEXT NOT NULL,
  last_success_at      DATETIME,
  last_failure_at      DATETIME,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_name      TEXT,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, job_name)
);

-- A NAME IS NOT A MESSAGE. Bounded hard, and refused if it looks like prose.
-- An error class is one identifier; anything longer is a message in the wrong
-- column, and a message can carry a customer's words into a table that is not
-- classified to hold them.
CREATE TRIGGER company_loop_health_error_name_guard
BEFORE INSERT ON company_loop_health
BEGIN
  SELECT RAISE(ABORT,'company_loop_health:error_name_is_not_a_message')
  WHERE NEW.last_error_name IS NOT NULL
    AND (length(NEW.last_error_name) > 64 OR NEW.last_error_name LIKE '% %');
END;

CREATE TRIGGER company_loop_health_error_name_update_guard
BEFORE UPDATE ON company_loop_health
BEGIN
  SELECT RAISE(ABORT,'company_loop_health:error_name_is_not_a_message')
  WHERE NEW.last_error_name IS NOT NULL
    AND (length(NEW.last_error_name) > 64 OR NEW.last_error_name LIKE '% %');
END;
