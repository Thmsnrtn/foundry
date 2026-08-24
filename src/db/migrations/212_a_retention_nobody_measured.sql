-- =============================================================================
-- Migration 212: the cohort columns that could not say "we never measured this"
--
-- `cohorts` has ten outcome columns — activation, retention at 7/14/30/60/90
-- days, conversions, churn, MRR contribution — and every one of them is
-- `INTEGER DEFAULT 0`. NOTHING IN THIS CODEBASE WRITES ANY OF THEM.
--
-- The only production writer of this table is the Clerk signup webhook, which
-- increments `founder_count` on FOUNDRY'S OWN product. For a customer company
-- the table is empty; for Foundry's own, every cohort carries a full row of
-- zeros. Six readers take those zeros as measurements:
--
--   the Cohorts page          "0%" at day 7, 14 and 30, beside a "Historical
--                             Avg" row of the same zeros;
--   `GET /api/products/:id/cohorts`   the same, as JSON;
--   `getLatestCohortSummary`  a retention figure the stressor engine compares
--                             against the average — the empty-cohort case was
--                             repaired earlier; the unmeasured case is this one;
--   Harbor's prompt           "activation=0.0%, day30_retention=0.0%" per
--                             cohort, stated to a model as this company's data;
--   Beacon's prompt           acquisition channels RANKED by an activation rate
--                             that is zero for all of them;
--   the retention stressor    which cannot fire, because the deviation it needs
--                             is computed from numbers nobody produces.
--
-- Removing the defaults is the same repair as migration 202: no default, so an
-- INSERT that does not mention a column stores NULL, and NULL means WE WERE NOT
-- TOLD. `founder_count` keeps its default — the signup webhook increments it,
-- and a cohort with nobody in it is a real, countable state.
--
-- WHAT THIS DOES NOT DO. It does not make retention measurable. Cohort analysis
-- is sold on the Investor-Ready tier and promises retention curves, channel
-- attribution and automatic deviation stressors; none of the three has a
-- producing half for any customer company. That is an owner-facing gap, written
-- down in AUTONOMOUS_CAMPAIGN_STATE, not something to paper over with a zero.
--
-- SQLite cannot alter a column's default in place, so this is the standard
-- rebuild: create, copy, drop, rename, recreate the three indexes.
-- =============================================================================

CREATE TABLE cohorts_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  acquisition_period DATE NOT NULL,
  acquisition_channel TEXT,
  acquisition_source TEXT,
  -- Countable: the signup webhook increments this.
  founder_count INTEGER DEFAULT 0,
  -- Absent means absent, on every one of these.
  activated_count INTEGER,
  retained_day_7 INTEGER,
  retained_day_14 INTEGER,
  retained_day_30 INTEGER,
  retained_day_60 INTEGER,
  retained_day_90 INTEGER,
  converted_to_paid INTEGER,
  churned_count INTEGER,
  avg_activation_minutes REAL,
  mrr_contribution_cents INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, acquisition_period, acquisition_channel)
);

INSERT INTO cohorts_new
  (id, product_id, acquisition_period, acquisition_channel, acquisition_source,
   founder_count, activated_count, retained_day_7, retained_day_14,
   retained_day_30, retained_day_60, retained_day_90, converted_to_paid,
   churned_count, avg_activation_minutes, mrr_contribution_cents,
   created_at, updated_at)
SELECT
   id, product_id, acquisition_period, acquisition_channel, acquisition_source,
   founder_count, activated_count, retained_day_7, retained_day_14,
   retained_day_30, retained_day_60, retained_day_90, converted_to_paid,
   churned_count, avg_activation_minutes, mrr_contribution_cents,
   created_at, updated_at
FROM cohorts;

DROP TABLE cohorts;

ALTER TABLE cohorts_new RENAME TO cohorts;

CREATE INDEX IF NOT EXISTS idx_cohorts_product ON cohorts(product_id);
CREATE INDEX IF NOT EXISTS idx_cohorts_channel ON cohorts(acquisition_channel);
CREATE INDEX IF NOT EXISTS idx_cohorts_product_channel ON cohorts(product_id, acquisition_channel);
