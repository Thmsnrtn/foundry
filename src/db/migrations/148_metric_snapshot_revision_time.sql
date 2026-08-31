-- =============================================================================
-- Migration 148: a revised metric snapshot must record when it was revised
--
-- `POST /v1/metrics` upserts on (product_id, snapshot_date) and its DO UPDATE
-- clause ends with `updated_at = CURRENT_TIMESTAMP`. `metric_snapshots` has no
-- `updated_at`, so every upsert raised — meaning the FIRST submission for a
-- date succeeded and every correction to it returned a 500. On the public
-- ingestion path, which is the one the owner turned on.
--
-- The column is added rather than the assignment removed. `created_at` records
-- when the row was first written; a metric that has been restated is a
-- different fact from one that has not, and the restatement time is the only
-- thing that distinguishes them. Backfilled to `created_at` for existing rows:
-- a row never revised was last written when it was created.
-- =============================================================================

ALTER TABLE metric_snapshots ADD COLUMN updated_at DATETIME;

UPDATE metric_snapshots SET updated_at = created_at WHERE updated_at IS NULL;
