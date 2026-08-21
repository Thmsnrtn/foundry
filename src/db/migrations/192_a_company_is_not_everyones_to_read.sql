-- =============================================================================
-- A COMPANY IS NOT EVERYONE'S TO READ.
--
-- This migration carries one small schema change; the substance of the change
-- it belongs to is in code, and is recorded here because a schema file is where
-- a future reader looks for when something changed.
--
-- `founder_health.engagement_trend TEXT DEFAULT 'stable'`. IMPLEMENTATION_STATE
-- already names this as a known defect — "a column default is not an
-- observation: a row written for any other reason looked like a judgment that a
-- person was doing fine" — and this cycle fixed the code half by giving
-- `EngagementTrend` an 'unknown' value and returning it when there is nothing to
-- read. The default stayed, which meant the fix was half done: any writer that
-- omits the column still says a person is stable.
--
-- Same treatment as migration 190 gave `products.health_score DEFAULT 0` and
-- `agent_instances.domain_health_score DEFAULT 50`: the default goes, values are
-- preserved through a new column, and no row is rewritten. Existing 'stable'
-- rows are LEFT ALONE — unlike the 190 cases there is no exact test to tell a
-- default 'stable' from a computed one, and overwriting a real judgement to
-- tidy a default would be the same defect in reverse.
-- =============================================================================

ALTER TABLE founder_health ADD COLUMN engagement_trend_v2 TEXT;
UPDATE founder_health SET engagement_trend_v2 = engagement_trend;
ALTER TABLE founder_health DROP COLUMN engagement_trend;
ALTER TABLE founder_health RENAME COLUMN engagement_trend_v2 TO engagement_trend;
