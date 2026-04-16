-- Migration 030: Anonymous opt-in benchmarking pool
-- Allows products to contribute anonymised metric snapshots to a shared pool
-- and query back percentile benchmarks against similar companies.
-- product_id is stored in contributions for internal reference only —
-- it must never be exposed in any public or cross-product query.

-- benchmark_contributions: each row is one anonymised snapshot contributed by a product
-- Values are bucketed (mrr_bucket, team_size_bucket) to prevent re-identification.
-- lifecycle_state and company_category are used as the primary segmentation axes.
CREATE TABLE IF NOT EXISTS benchmark_contributions (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL,        -- kept private, never joined publicly
  lifecycle_state     TEXT NOT NULL,
  company_category    TEXT NOT NULL CHECK (company_category IN (
                        'b2b_saas','b2c_saas','marketplace','developer_tools','fintech','other'
                      )),
  team_size_bucket    TEXT NOT NULL CHECK (team_size_bucket IN ('1','2-5','6-15','16-50','50+')),
  mrr_bucket          TEXT NOT NULL CHECK (mrr_bucket IN ('0-1k','1k-10k','10k-50k','50k-200k','200k+')),

  -- Core growth and retention metrics (nullable — contribute what you have)
  activation_rate     REAL,
  day_30_retention    REAL,
  churn_rate          REAL,
  nps_score           REAL,
  cac_usd             REAL,
  ltv_usd             REAL,
  ai_cost_pct_of_mrr  REAL,

  contributed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_benchmark_contrib_segment
  ON benchmark_contributions(lifecycle_state, company_category, contributed_at);

-- benchmark_percentiles: pre-computed percentile bands refreshed periodically by a system job
-- p25/p50/p75/p90 store the metric value at each percentile for the given segment
-- sample_count tracks how many contributions informed each row (minimum threshold enforced in app)
CREATE TABLE IF NOT EXISTS benchmark_percentiles (
  id               TEXT PRIMARY KEY,
  lifecycle_state  TEXT NOT NULL,
  company_category TEXT NOT NULL,
  metric_name      TEXT NOT NULL,   -- e.g. 'activation_rate', 'churn_rate', 'nps_score'
  p25              REAL,
  p50              REAL,
  p75              REAL,
  p90              REAL,
  sample_count     INTEGER NOT NULL,
  computed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_percentiles_unique
  ON benchmark_percentiles(lifecycle_state, company_category, metric_name, computed_at);

CREATE INDEX IF NOT EXISTS idx_benchmark_percentiles_segment
  ON benchmark_percentiles(lifecycle_state, company_category, metric_name);
