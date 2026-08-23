-- =============================================================================
-- Migration 028: Automated Growth Experiments
-- A/B test framework with statistical significance detection.
-- =============================================================================

-- THIS STATEMENT DID NOT RUN. `experiments` was created by `023_experiments_strategy.sql`, and
-- `CREATE TABLE IF NOT EXISTS` over an existing table does nothing — so the
-- columns below are a PROPOSAL, not the schema. The live shape is the earlier
-- one plus whatever later migrations added by ALTER; read
-- `docs/db/schema.snapshot.sql` for what the database actually has.
-- `tests/unit/only-the-first-create-is-the-schema.test.ts` pins the full list.
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  experiment_type TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  variants TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  secondary_metrics TEXT,
  traffic_split TEXT,
  sample_size_target INTEGER,
  current_sample_size INTEGER DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  results TEXT,
  winner TEXT,
  confidence_level REAL,
  decision_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiment_events (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  variant TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value REAL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiments_product ON experiments(product_id, status);
CREATE INDEX IF NOT EXISTS idx_exp_events ON experiment_events(experiment_id, variant);
