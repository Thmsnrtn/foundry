-- =============================================================================
-- A DESIGN THE FORGE COULD NOT SEAL IS NOT STRANDED (Stage 1, F1.5).
--
-- A design was sealed or not once, inside the deliberation, and the daily pass
-- took up only tests with no design or a sealed one. So a design refused
-- because no charter stood, the charter was full, an exchange was not yet
-- runnable or the attacker said reframe/defer was never looked at again, and,
-- not being a forge refusal, the give-up rule never retired it either.
--
-- `facts`: what the seal was decided against (the charter's answer, what
-- stands in the design's way, the evidence on the candidate), as one string.
-- An unsealed design is recorded as a refusal with it; a later pass takes the
-- design up again only when the facts now differ, or the owner asked. NULL on
-- refusals before this migration and on refusals that never reached a design.
--
-- `forge_rerun_asks`: the owner asked that the waiting designs be taken up
-- again on the next pass, whatever their facts. Names a test, no person.
-- =============================================================================
ALTER TABLE forge_refusals ADD COLUMN facts TEXT;

CREATE TABLE IF NOT EXISTS forge_rerun_asks (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  asked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forge_rerun_asks_experiment ON forge_rerun_asks(experiment_id, asked_at);
