-- =============================================================================
-- 368 — WHAT ONE OWNER DOES NOT NEED, KEPT RATHER THAN LOST.
--
-- Foundry is the owner's alone (Private S7, 29 September 2026). The
-- co-founder alignment score and the cross-company benchmark pool served
-- somebody who is not the owner; their code went in the same change, and
-- these three tables are left with nothing that reads or writes them.
--
-- NOTHING IS LOST. Every row is copied into retired_rows as JSON before its
-- table is dropped, so any of it can be restored by hand. retired_rows carries
-- product_id where the row had one, which puts it under the ordinary
-- company erasure and export (both find every table with a product_id); a
-- row with none, a percentile over a cohort, names no company.
--
-- The code before this deletion is commit 7d3129af, tagged
-- archive/multi-user-2026-09-29 by the owner.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retired_rows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  product_id  TEXT,
  row_json    TEXT NOT NULL,
  retired_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_retired_rows_table ON retired_rows(table_name);
CREATE INDEX IF NOT EXISTS idx_retired_rows_product ON retired_rows(product_id);

-- A retired row is evidence of what was. It is not edited.
CREATE TRIGGER IF NOT EXISTS retired_rows_are_kept_as_they_were
BEFORE UPDATE ON retired_rows
BEGIN
  SELECT RAISE(ABORT, 'retired_rows are kept as they were');
END;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'alignment_snapshots', product_id, json_object(
  'id', id, 'product_id', product_id, 'snapshot_date', snapshot_date,
  'alignment_score', alignment_score, 'signal_consensus', signal_consensus,
  'divergence_areas', divergence_areas, 'risk_state_consensus', risk_state_consensus,
  'priority_consensus', priority_consensus, 'notes', notes, 'created_at', created_at)
FROM alignment_snapshots;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'benchmark_contributions', product_id, json_object(
  'id', id, 'product_id', product_id, 'lifecycle_state', lifecycle_state,
  'company_category', company_category, 'team_size_bucket', team_size_bucket,
  'mrr_bucket', mrr_bucket, 'activation_rate', activation_rate,
  'day_30_retention', day_30_retention, 'churn_rate', churn_rate,
  'nps_score', nps_score, 'cac_usd', cac_usd, 'ltv_usd', ltv_usd,
  'ai_cost_pct_of_mrr', ai_cost_pct_of_mrr, 'contributed_at', contributed_at)
FROM benchmark_contributions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'benchmark_percentiles', NULL, json_object(
  'id', id, 'lifecycle_state', lifecycle_state, 'company_category', company_category,
  'metric_name', metric_name, 'p25', p25, 'p50', p50, 'p75', p75, 'p90', p90,
  'sample_count', sample_count, 'computed_at', computed_at)
FROM benchmark_percentiles;

DROP TABLE IF EXISTS alignment_snapshots;
DROP TABLE IF EXISTS benchmark_contributions;
DROP TABLE IF EXISTS benchmark_percentiles;
