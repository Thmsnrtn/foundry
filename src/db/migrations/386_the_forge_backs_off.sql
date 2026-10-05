-- =============================================================================
-- THE FORGE BACKS OFF WHAT IT KEEPS BEING REFUSED (Roadmap 2027 R27).
--
-- A test the forge could not design, or a sealed test the hands could not
-- make, was tried again on every daily pass at the cost of a model call each
-- time. One row per refusal, so the same stage of the same test waits longer
-- after each, and is retired with its reasons after the fourth. A call that
-- failed (threw) is not a refusal and is never written here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS forge_refusals (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('deliberate', 'make')),
  because TEXT NOT NULL,
  refused_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forge_refusals_experiment ON forge_refusals(experiment_id, stage, refused_at);
