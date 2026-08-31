-- =============================================================================
-- A CURRENCY NOBODY COULD REPORT.
--
-- Migration 011 added `metric_snapshots.local_currency_mrr` and
-- `exchange_rate`. In the time since, nothing has ever written either: no ingest
-- field accepts them, no integration computes them, no route sets them, no job
-- fills them. A company has no way to tell Foundry what its local-currency
-- revenue is.
--
-- One reader existed — `detectCurrencyErosion`, served live on
-- `GET /api/currency-health` — and because the columns are always NULL its `?? 0`
-- fallbacks were the entire input. Zero minus zero is a flat local trend, and a
-- flat local trend against a declining USD one IS the erosion condition, so the
-- endpoint reported currency erosion whenever the other series fell. That other
-- series was `new_mrr_cents`: one period's new business, compared against what
-- would have been a level.
--
-- The reader is retired with this migration, on the owner decision recorded at
-- 157. The columns go with it, because a column no path can fill is not a place
-- for data to arrive — it is a place for a fallback to be mistaken for one. If
-- currency exposure is wanted it comes back whole: an ingest field a company can
-- fill, a stored rate, and a comparison between two series of the same kind.
-- =============================================================================

ALTER TABLE metric_snapshots DROP COLUMN local_currency_mrr;
ALTER TABLE metric_snapshots DROP COLUMN exchange_rate;
