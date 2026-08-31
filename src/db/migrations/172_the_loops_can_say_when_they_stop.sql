-- =============================================================================
-- Migration 172: Foundry can tell when part of Foundry has stopped running
--
-- Every scheduled job is wrapped in a try/catch that logs and moves on. Nothing
-- durable records that it failed. So if the effect-reconciliation pass, or the
-- judgment tick, throws on every run for a week, the letter looks exactly like
-- a calm week: no new outcomes, no new judgments, nothing wrong on its face.
--
-- The founder is reading a page whose freshness depends on loops they cannot
-- see. "Nothing happened" and "nothing ran" are different facts and the page
-- said the first for both.
--
-- WHAT IS RECORDED IS THE SHAPE. The error's CLASS NAME only, never its
-- message: a message carries whatever the failure was carrying — a customer
-- address, a provider response, a fragment of a secret — and a health table is
-- the last place that should end up. The class name is enough to tell a
-- migration failure from a network failure and cannot carry data.
--
-- Consecutive failures rather than a total, because what a founder needs to
-- know is whether it is failing NOW, and a lifetime count never goes down.
-- =============================================================================

CREATE TABLE IF NOT EXISTS job_health (
  job_name             TEXT PRIMARY KEY,
  last_success_at      TEXT,
  last_failure_at      TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_name      TEXT,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A NAME IS NOT A MESSAGE. Bounded hard, and refused if it looks like prose:
-- an error class is one identifier, and anything longer is somebody putting a
-- message where the name goes.
CREATE TRIGGER job_health_error_name_guard
BEFORE INSERT ON job_health
BEGIN
  SELECT RAISE(ABORT,'job_health:error_name_is_not_a_message')
  WHERE NEW.last_error_name IS NOT NULL
    AND (length(NEW.last_error_name) > 64 OR NEW.last_error_name LIKE '% %');
END;

CREATE TRIGGER job_health_error_name_update_guard
BEFORE UPDATE ON job_health
BEGIN
  SELECT RAISE(ABORT,'job_health:error_name_is_not_a_message')
  WHERE NEW.last_error_name IS NOT NULL
    AND (length(NEW.last_error_name) > 64 OR NEW.last_error_name LIKE '% %');
END;
