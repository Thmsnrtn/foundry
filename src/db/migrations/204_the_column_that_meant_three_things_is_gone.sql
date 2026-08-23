-- =============================================================================
-- Migration 204: `integrations.type` is retired
--
-- Step two of the repair migration 203 began. `direction` says which way a
-- connection points and `provider` says who it is with; both are backfilled,
-- every writer sets them, and every reader reads them. What is left is the
-- column that meant all three depending on who wrote the row.
--
-- ONE BACKFILL FIRST. Migration 203 filled `provider` for the rows whose
-- provider key was hiding in `type`. The rows the FABRIC wrote carried a
-- direction in `type` and their provider in `name` — so their `provider` is
-- still empty, and dropping `type` before filling it would leave rows nothing
-- could dispatch. `name` is the provider on that path and always has been.
--
-- Then the column goes. SQLite can drop a column in place when no index or
-- trigger references it, and none does: the two `integration_config_no_secrets`
-- triggers match on `json_type`, which is a function.
--
-- WHAT A READER SHOULD DO WITH AN OLD ROW. Nothing special. Every row that
-- reaches a reader now has a direction or is deliberately left alone, and has a
-- provider or cannot be dispatched — which was true of `type` too, except that
-- nobody could tell which question they were answering.
-- =============================================================================

UPDATE integrations
   SET provider = name
 WHERE provider IS NULL AND name IS NOT NULL AND TRIM(name) != '';

ALTER TABLE integrations DROP COLUMN type;
