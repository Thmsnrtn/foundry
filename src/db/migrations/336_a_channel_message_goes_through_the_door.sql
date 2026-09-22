-- =============================================================================
-- A CHANNEL MESSAGE GOES THROUGH THE DOOR LIKE EVERY OTHER MESSAGE.
--
-- A reconstruction of the institution's external effects found exactly one
-- outbound-mutating integration that did not pass the outbound door:
-- `sendSlackNotification` posted to `chat.postMessage` with a bare `fetch`.
-- Its caller in the action executor called it directly, while the email path
-- beside it — the same function, the same approval, the same table — went
-- through `invoke`.
--
-- WHAT WAS BYPASSED, precisely: the kill switch (a paused company, a disabled
-- tool, and the owner's standing "never"/"ask me first" boundaries), the
-- consequence rung, the surface and data-class assertions, dedup, the
-- communication budget, and the audit row. `post_slack` is already in
-- `REACHES_A_PERSON` in `standing-intent.ts`, so the owner's contact boundary
-- was written to cover it and could not see it.
--
-- The capability already exists: `post_to_channel` at rung `public`, seeded by
-- 243. What was missing is the row binding a TOOL to it. Until that row exists
-- `consequenceAllows` refuses the tool outright — "a tool bound to nothing is
-- refused" — which is why this migration is the half of the repair that makes
-- the other half possible rather than an afterthought to it.
--
-- `available` and no further: it exists and is exercised in tests. What it has
-- done in the world is for the witnessed record to say.
-- =============================================================================

INSERT OR IGNORE INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_post_slack', 'post_to_channel', 'slack', 'api', 'post_slack', 'nothing', 'available', 2);
