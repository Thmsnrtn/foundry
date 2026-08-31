-- =============================================================================
-- AN INTEGRATION WITH NO NAME, INVISIBLE TO HALF ITS OWN SYNCS.
--
-- `integrations.name` is how the event syncs identify an integration.
-- `getIntegration(productId, name)` matches `WHERE product_id = ? AND name = ?`,
-- and all six of sentry/linear/intercom/slack/posthog/github call it that way.
-- With `name` NULL the lookup returns nothing and every one of them returns
-- `{ synced: 0 }` on its first branch — silently, because "not connected" and
-- "connected but found nothing" are the same return value.
--
-- `POST /integrations/:type/connect` never wrote it. `sync.ts`, the metrics
-- path, matches on `type` instead, so THE SAME ROW was visible to one sync and
-- invisible to the other, and which of the two live connect pages a founder
-- used decided whether their integration ever produced events: the sibling form
-- at `/agents/integrations` goes through `connectIntegration`, which does write
-- `name`.
--
-- THE REPAIR IS DELIBERATELY NARROW. `type` does not mean the same thing to
-- every writer: this route puts the PROVIDER KEY in it, `fabric.ts` and
-- `framework.ts` put a CATEGORY there and the provider key in `name`, and
-- `connections.ts` puts a direction ('outbound') there. A blanket
-- `SET name = type` would write 'inbound' and 'outbound' into a column the
-- syncs compare against provider names, inventing integrations called
-- "outbound".
--
-- So only the nine values this route can produce are repaired — the
-- `IntegrationType` union, which is also exactly the `INTEGRATION_META` keys
-- that page renders. A row whose `type` is anything else was written by a
-- different writer, which already set `name` itself.
--
-- Rows this page created before it started writing `name` are also repaired on
-- reconnect, by the COALESCE in its UPDATE branch.
-- =============================================================================

UPDATE integrations
   SET name = type
 WHERE name IS NULL
   AND type IN ('stripe','posthog','intercom','linear','slack','mixpanel',
                'amplitude','app_store_connect','github_app');
