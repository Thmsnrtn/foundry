-- =============================================================================
-- Migration 147: a hypothesis that could not be told apart from noise is not
-- a hypothesis that was disproven
--
-- `experiments.winner` has three values — 'control', 'treatment',
-- 'inconclusive' — because an experiment can end without separating the arms.
-- `hypotheses.status` has six, and none of them means that. So the code that
-- records a result had nowhere to put "we ran it and could not tell", and
-- wrote 'disproven':
--
--     const newStatus = results.significant ? 'completed' : 'disproven';
--
-- Absence of evidence, recorded as evidence of absence, in the table the
-- institution reads to decide what it has already learned. The column beside
-- it — `disproven_evidence`, "If disproven, why" — was left NULL, because
-- there was no evidence; the schema asked the question the write could not
-- answer and nothing enforced it.
--
-- This adds the value the vocabulary was missing. It changes no existing row:
-- rows already marked 'disproven' stay marked, because this migration cannot
-- know which of them were genuinely contradicted and which were merely
-- unresolved, and guessing would replace one false record with another.
--
-- SQLite cannot ALTER a CHECK, so the table is rebuilt. `experiments`
-- references it, hence foreign_keys=OFF for the swap.
-- =============================================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS hypotheses_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL,
  validated_by TEXT,
  statement TEXT NOT NULL,
  null_hypothesis TEXT,
  predicted_effect_size REAL,
  minimum_detectable_effect REAL,
  required_sample_size INTEGER,
  estimated_duration_days INTEGER,
  confidence_level REAL DEFAULT 0.95,
  risk_assessment TEXT,
  revenue_impact_estimate TEXT,
  estimated_cost_usd REAL,
  predicted_roi REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN (
    'proposed','approved','active','completed','abandoned','disproven',
    -- Tested. The arms did not separate. Nothing was learned about the
    -- statement either way, and the institution must not be told otherwise.
    'inconclusive'
  )),
  disproven_evidence TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  power_check_passed    INTEGER NOT NULL DEFAULT 0,
  conflict_check_passed INTEGER NOT NULL DEFAULT 0
);

INSERT INTO hypotheses_new (
  id, product_id, proposed_by, validated_by, statement, null_hypothesis,
  predicted_effect_size, minimum_detectable_effect, required_sample_size,
  estimated_duration_days, confidence_level, risk_assessment,
  revenue_impact_estimate, estimated_cost_usd, predicted_roi, status,
  disproven_evidence, created_at, updated_at, power_check_passed,
  conflict_check_passed
)
  SELECT
    id, product_id, proposed_by, validated_by, statement, null_hypothesis,
    predicted_effect_size, minimum_detectable_effect, required_sample_size,
    estimated_duration_days, confidence_level, risk_assessment,
    revenue_impact_estimate, estimated_cost_usd, predicted_roi, status,
    disproven_evidence, created_at, updated_at, power_check_passed,
    conflict_check_passed
  FROM hypotheses;

DROP TABLE hypotheses;
ALTER TABLE hypotheses_new RENAME TO hypotheses;

CREATE INDEX IF NOT EXISTS idx_hypotheses_product ON hypotheses(product_id, status);

PRAGMA foreign_keys=ON;
