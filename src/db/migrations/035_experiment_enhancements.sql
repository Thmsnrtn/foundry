-- Migration 035: Richer experiment tracking
-- Adds statistical timeline checkpoints, holdout group management, and
-- power-analysis fields to the existing experiments and hypotheses tables.
-- Pre-mortem and learnings fields capture qualitative experiment context.

-- experiment_results_timeline: periodic statistical snapshots during a running experiment
-- Allows agents to detect early stopping conditions (significant result or futility).
-- p_value and effect_size are computed externally and stored here.
-- is_significant = 1 means the result crossed the pre-specified alpha threshold.
CREATE TABLE IF NOT EXISTS experiment_results_timeline (
  id               TEXT PRIMARY KEY,
  experiment_id    TEXT NOT NULL REFERENCES experiments(id),
  checkpoint_date  TEXT NOT NULL,     -- ISO date of this statistical snapshot
  control_n        INTEGER,           -- observations in control group at checkpoint
  treatment_n      INTEGER,           -- observations in treatment group at checkpoint
  control_mean     REAL,
  treatment_mean   REAL,
  p_value          REAL,
  effect_size      REAL,
  is_significant   INTEGER NOT NULL DEFAULT 0,  -- 1 when p_value < pre-specified alpha
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exp_timeline_experiment
  ON experiment_results_timeline(experiment_id, checkpoint_date);

-- experiment_holdouts: defines a persistent holdout group excluded from all experiments
-- Holdout groups let teams measure the cumulative lift of all experiments combined.
-- holdout_pct is a fraction (0.0–1.0) of users permanently withheld from treatment.
CREATE TABLE IF NOT EXISTS experiment_holdouts (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  holdout_name  TEXT NOT NULL DEFAULT 'primary',
  holdout_pct   REAL NOT NULL DEFAULT 0.1,   -- fraction of users, e.g. 0.1 = 10 %
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exp_holdouts_product
  ON experiment_holdouts(product_id, is_active);

-- Extend experiments with qualitative fields and holdout linkage.
-- pre_mortem: written before the experiment starts — what could go wrong?
-- learnings: written after completion — what did we actually learn?
-- holdout_id: links the experiment to its exclusion holdout group (nullable)
ALTER TABLE experiments ADD COLUMN pre_mortem  TEXT;
ALTER TABLE experiments ADD COLUMN learnings   TEXT;
ALTER TABLE experiments ADD COLUMN holdout_id  TEXT REFERENCES experiment_holdouts(id);

-- Extend hypotheses with power-analysis fields.
-- required_sample_size: minimum n per arm for the desired power/alpha
-- minimum_detectable_effect: the smallest effect the test is powered to detect
-- power_check_passed = 1 once an agent has verified statistical viability
-- conflict_check_passed = 1 once an agent has confirmed no overlapping running experiments
ALTER TABLE hypotheses ADD COLUMN required_sample_size        INTEGER;
ALTER TABLE hypotheses ADD COLUMN minimum_detectable_effect   REAL;
ALTER TABLE hypotheses ADD COLUMN power_check_passed          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hypotheses ADD COLUMN conflict_check_passed       INTEGER NOT NULL DEFAULT 0;
