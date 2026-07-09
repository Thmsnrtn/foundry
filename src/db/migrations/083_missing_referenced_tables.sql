-- =============================================================================
-- Migration 083: Create three tables the shipped code references but no
-- migration ever created (phantom-table audit — same code-vs-schema class as
-- the billing-webhook fixes).
--
-- A codebase scan for `FROM/INTO/UPDATE/JOIN <table>` against the real schema
-- found handlers querying tables that don't exist. On a real DB these throw
-- "no such table" and 500 the request:
--   • agent_decisions     — the /inbox "Decisions" tab SELECTs it and both the
--     approve/dismiss POST handlers UPDATE it; the investor board-packet reads
--     it too. The whole dashboard page 500s on load today. (No writer yet — the
--     tab renders empty until agents populate it — but it must not crash.)
--   • customer_notes      — GET /api/v1/customers/:id fetches recent notes.
--   • experiment_variants — the experiments API reads and INSERTs variants.
--
-- Schemas are inferred from every column the code touches. Creating the tables
-- (vs deleting the features) matches the evident intent: the code was written
-- expecting them; only the migration was omitted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_decisions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT,
  priority TEXT,
  title TEXT,
  decision_title TEXT,
  description TEXT,
  rationale TEXT,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | dismissed
  approved_at DATETIME,
  approved_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_product ON agent_decisions(product_id, status);

CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_notes_lookup ON customer_notes(product_id, customer_id);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  traffic_pct REAL,
  results_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_experiment_variants_experiment ON experiment_variants(experiment_id);
