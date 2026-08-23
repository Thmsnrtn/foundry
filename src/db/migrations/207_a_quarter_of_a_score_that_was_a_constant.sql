-- =============================================================================
-- Migration 207: the quarter of the M&A readiness score that was a constant
--
-- `customer_concentration_score` carries weight 0.25 in the readiness score a
-- founder is shown when asking whether their company is ready to be acquired —
-- joint-heaviest with revenue quality. Both of its inputs were dead:
--
--   * `topCustomerMrrPct` was a hardcoded `null`, under a comment saying
--     per-customer MRR is not in the schema. It is: `customers.mrr_cents`.
--   * `customerCount` read `metric_snapshots.customer_count`, a column that has
--     never existed in any migration, so `?? 0` made it zero for every company.
--
-- With count 0 the scorer returned its "no data" branch, 5.0, every time. The
-- dimension was a constant presented as a measurement, with its own score bar,
-- and its `< 7` test then printed "Customer concentration risk — reduce
-- dependency on top customers" as a finding about the company when it was a
-- finding about the data.
--
-- The scorer now measures the customers Foundry actually has, and returns NULL
-- when it knows of no paying customer. NULL is the reason for this migration:
-- the column was `REAL NOT NULL`, and SQLite cannot drop NOT NULL in place, so
-- this is the standard rebuild — create, copy, drop, rename, recreate index.
--
-- WHAT HAPPENS TO THE ROWS ALREADY STORED. Every one of them holds exactly 5.0
-- in this column, and that 5.0 measured nothing. Three statements follow the
-- rebuild:
--
--   1. `overall_score` is recomputed over the four dimensions that were
--      measured, renormalised by their weights (0.75) exactly as the code now
--      does. The stored number then rests only on what was measured.
--   2. `ready_to_be_acquired` is recomputed from that score against the same
--      7.0 threshold, because it was derived from the number that just changed.
--   3. The concentration gap sentence is replaced with the one the code now
--      writes: a gap in Foundry's records, stated as one.
--
-- Then the column is set NULL for those rows. All four statements are guarded
-- on `customer_concentration_score = 5.0`: a row holding any other value came
-- from a scorer that measured something, and is left exactly as it is.
-- =============================================================================

CREATE TABLE ma_readiness_scores_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  assessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  overall_score REAL NOT NULL, -- 0-10, over the dimensions that were measured
  revenue_quality_score REAL NOT NULL, -- MRR predictability, NRR, churn
  ip_clarity_score REAL NOT NULL, -- code ownership, no IP disputes, clean licenses
  team_retention_score REAL NOT NULL, -- key person risk, vesting cliffs
  integration_complexity_score REAL NOT NULL, -- API quality, data portability, tech debt
  -- NULL = Foundry knows of no paying customer for this company, so the
  -- dimension was not scored. Not the same as a middling concentration.
  customer_concentration_score REAL,
  ready_to_be_acquired INTEGER NOT NULL DEFAULT 0, -- boolean
  key_gaps_json TEXT NOT NULL, -- JSON array of gaps
  target_acquirer_profile TEXT, -- what kind of acquirer would pay a premium
  estimated_multiple_range TEXT -- e.g. "5-8x ARR"
);

INSERT INTO ma_readiness_scores_new
  (id, product_id, assessed_at, overall_score, revenue_quality_score,
   ip_clarity_score, team_retention_score, integration_complexity_score,
   customer_concentration_score, ready_to_be_acquired, key_gaps_json,
   target_acquirer_profile, estimated_multiple_range)
SELECT
   id, product_id, assessed_at, overall_score, revenue_quality_score,
   ip_clarity_score, team_retention_score, integration_complexity_score,
   customer_concentration_score, ready_to_be_acquired, key_gaps_json,
   target_acquirer_profile, estimated_multiple_range
FROM ma_readiness_scores;

DROP TABLE ma_readiness_scores;

ALTER TABLE ma_readiness_scores_new RENAME TO ma_readiness_scores;

CREATE INDEX IF NOT EXISTS idx_ma_readiness_product
  ON ma_readiness_scores(product_id, assessed_at DESC);

UPDATE ma_readiness_scores
   SET overall_score = ROUND(
         (revenue_quality_score * 0.25 + ip_clarity_score * 0.15 +
          team_retention_score * 0.20 + integration_complexity_score * 0.15)
         / 0.75, 1)
 WHERE customer_concentration_score = 5.0;

UPDATE ma_readiness_scores
   SET ready_to_be_acquired = CASE WHEN overall_score >= 7.0 THEN 1 ELSE 0 END
 WHERE customer_concentration_score = 5.0;

UPDATE ma_readiness_scores
   SET key_gaps_json = REPLACE(
         key_gaps_json,
         'Customer concentration risk — reduce dependency on top customers, target no single customer > 20% of MRR',
         'Foundry knows of no paying customers for this company, so customer concentration is not scored — report your top-customer revenue share separately before diligence')
 WHERE customer_concentration_score = 5.0;

UPDATE ma_readiness_scores
   SET customer_concentration_score = NULL
 WHERE customer_concentration_score = 5.0;
