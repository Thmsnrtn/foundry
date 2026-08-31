-- =============================================================================
-- Migration 202: four columns that could not say "nothing was reported"
--
-- `new_mrr_cents`, `expansion_mrr_cents`, `contraction_mrr_cents` and
-- `churned_mrr_cents` were `INTEGER DEFAULT 0`. A company that reported a
-- genuine zero and a company that reported no movement at all stored the same
-- value, and every reader that added them up inherited the ambiguity.
--
-- It was not theoretical. A daily job inserted an empty snapshot for every
-- company (removed in the commit before this one), so the newest row was
-- usually one nobody had written a number into — and the decomposition read it
-- as a month in which nothing was won, nothing churned and nothing expanded.
-- Ten importers took that as fact: the founder's chat context listed the zeros,
-- the COO prompt said "net new this period: $0", and the voice briefing spoke
-- "net new MRR this period: flat" aloud.
--
-- Four separate repairs worked around it. This removes the ambiguity at the
-- source: no default, so an INSERT that does not mention a column stores NULL,
-- and NULL means WE WERE NOT TOLD.
--
-- WHAT THIS CANNOT DO. Rows already written cannot be repaired: the information
-- that would tell a reported 0 from an unreported movement was never stored, so
-- every existing 0 stays a 0 and stays ambiguous. New rows are honest; history
-- is what it is. Any surface showing a historical decomposition is showing a
-- number whose provenance it cannot establish, which is the reason to stop
-- adding to the pile now rather than later.
--
-- ACCUMULATE-IN-PLACE BREAKS ON NULL, and that is handled in the same change:
-- `stripe-webhook.ts` increments these columns with `col = col + ?`, and
-- `NULL + 5` is NULL in SQL — an increment against an unreported column would
-- have silently discarded the event. Every one of those five sites now reads
-- `COALESCE(col, 0) + ?`, which is the correct arithmetic for "the first
-- movement we have been told about".
--
-- SQLite cannot alter a column's default in place, so this is the standard
-- rebuild: create, copy, drop, rename, recreate indexes. `mrr_health_ratio` and
-- every other column keep their exact types and defaults.
-- =============================================================================

CREATE TABLE metric_snapshots_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  snapshot_date DATE NOT NULL,
  signups_7d INTEGER,
  active_users INTEGER,
  -- The four. No DEFAULT: absent means absent.
  new_mrr_cents INTEGER,
  expansion_mrr_cents INTEGER,
  contraction_mrr_cents INTEGER,
  churned_mrr_cents INTEGER,
  activation_rate REAL,
  day_30_retention REAL,
  support_volume_7d INTEGER,
  nps_score REAL,
  churn_rate REAL,
  mrr_health_ratio REAL,
  custom_metrics TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mrr_cents INTEGER,
  new_customers INTEGER,
  churned_customers INTEGER,
  updated_at DATETIME,
  UNIQUE (product_id, snapshot_date)
);

INSERT INTO metric_snapshots_new
  (id, product_id, snapshot_date, signups_7d, active_users,
   new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents,
   activation_rate, day_30_retention, support_volume_7d, nps_score, churn_rate,
   mrr_health_ratio, custom_metrics, created_at, mrr_cents, new_customers,
   churned_customers, updated_at)
SELECT
   id, product_id, snapshot_date, signups_7d, active_users,
   new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents,
   activation_rate, day_30_retention, support_volume_7d, nps_score, churn_rate,
   mrr_health_ratio, custom_metrics, created_at, mrr_cents, new_customers,
   churned_customers, updated_at
FROM metric_snapshots;

DROP TABLE metric_snapshots;

ALTER TABLE metric_snapshots_new RENAME TO metric_snapshots;

CREATE INDEX IF NOT EXISTS idx_metrics_product ON metric_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_metrics_product_date ON metric_snapshots(product_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_created ON metric_snapshots(created_at);
