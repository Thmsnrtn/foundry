-- =============================================================================
-- Migration 203: `integrations.type` meant three different things
--
-- Five writers, three meanings, and every reader had to guess which one it had:
--
--   dashboard/integrations.ts   the PROVIDER KEY  ('stripe', 'posthog', …)
--   integration/fabric.ts       a DIRECTION       ('inbound'|'outbound'|'bidirectional')
--   integrations/framework.ts   a CATEGORY        ('payment', 'analytics', …)
--   integrations/stripe-sync.ts a DIRECTION       ('inbound')
--   dashboard/connections.ts    a DIRECTION       ('outbound')
--
-- Three live defects came out of that one ambiguity, each fixed in isolation
-- and none of them the fix: a row visible to one sync and invisible to the
-- other; an outbound MCP connection dragged into the inbound sync until Foundry
-- told the founder it had "stopped syncing outbound" — a sentence about a
-- DIRECTION, announcing that it had given up on something it was never meant to
-- pull from; and a repair migration that would have created an integration
-- named "outbound" if it had copied `type` wholesale.
--
-- This is the repair the frontier note asked for, in two steps. Step one:
-- `direction` exists, is backfilled from what each row actually means, and is
-- refused any value outside the three. `provider` — which already exists and
-- which the framework path already writes — is backfilled for the rows whose
-- provider key was hiding in `type`.
--
-- Step two, in the commit after this one: every writer sets both columns, every
-- reader uses them, and `type` is retired. It stays NOT NULL until then, so the
-- two steps can be verified separately.
--
-- WHAT THE BACKFILL CAN AND CANNOT KNOW. A row whose `type` is already one of
-- the three directions says so. A row whose `type` is a provider key gets the
-- direction that provider actually has, from the same map `fabric.ts` uses. A
-- row whose `type` is a CATEGORY ('payment', 'analytics', 'support', 'issue
-- tracking') is a data source, so it is inbound. Anything unrecognised is left
-- for a person: NULL direction, and the reader that needs one says it cannot
-- tell rather than assuming a direction for a connection that might send.
-- =============================================================================

ALTER TABLE integrations ADD COLUMN direction TEXT;

-- 1. The rows that already carried a direction.
UPDATE integrations SET direction = type
 WHERE type IN ('inbound', 'outbound', 'bidirectional');

-- 2. The rows whose `type` was a provider key, and whose provider column is
--    therefore also missing. Both are set from the same value.
UPDATE integrations
   SET provider = COALESCE(provider, type),
       direction = CASE type
         WHEN 'resend'   THEN 'outbound'
         WHEN 'github'   THEN 'bidirectional'
         WHEN 'linear'   THEN 'bidirectional'
         WHEN 'slack'    THEN 'outbound'
         ELSE 'inbound'
       END
 WHERE direction IS NULL
   AND type IN ('stripe', 'posthog', 'plausible', 'mixpanel', 'google_analytics',
                'intercom', 'sentry', 'resend', 'github', 'linear', 'slack');

-- 3. The rows whose `type` was a CATEGORY. A data source is inbound.
UPDATE integrations SET direction = 'inbound'
 WHERE direction IS NULL
   AND type IN ('payment', 'analytics', 'support', 'issue_tracking', 'issue tracking',
                'error_tracking', 'crm', 'email', 'other');

-- A DIRECTION IS ONE OF THREE THINGS. Refused here rather than validated in
-- five writers, because the whole defect above is five writers disagreeing
-- about what a column holds.
CREATE TRIGGER IF NOT EXISTS integration_direction_vocabulary_insert
BEFORE INSERT ON integrations
WHEN NEW.direction IS NOT NULL
 AND NEW.direction NOT IN ('inbound', 'outbound', 'bidirectional')
BEGIN
  SELECT RAISE(ABORT, 'integration:direction is inbound, outbound or bidirectional');
END;

CREATE TRIGGER IF NOT EXISTS integration_direction_vocabulary_update
BEFORE UPDATE OF direction ON integrations
WHEN NEW.direction IS NOT NULL
 AND NEW.direction NOT IN ('inbound', 'outbound', 'bidirectional')
BEGIN
  SELECT RAISE(ABORT, 'integration:direction is inbound, outbound or bidirectional');
END;
