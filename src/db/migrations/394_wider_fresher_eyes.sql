-- =============================================================================
-- 394 — WIDER, FRESHER EYES (F3, 9 October 2026).
--
-- Two more ways of looking, and the terms each source is read under:
--
--   * a MARKETPLACE: Etsy's active listings, searched through its Open API v3
--     with the application key the owner placed (never its website), for what
--     already sells, at what price, and with how many buyers' reviews. It
--     supplies `marketplace` (stance `transaction`) through the existing
--     `read_marketplace_listings` capability (public_observation: a shelf
--     anybody may browse). DECLARED: no request has been answered by Etsy.
--   * a SECOND FORUM: Stack Exchange's question sites through API 2.3, newest
--     first, supplying `community` (stance `problem_pain`) through the existing
--     `read_community_discussion`. DECLARED.
--
--   * WHETHER A SOURCE'S TERMS ALLOW IT (services/venture/sources/terms.ts):
--     two sources answer without any published term licensing a program to
--     read them this way — DuckDuckGo's suggestion endpoint and Etsy's listing
--     search for research. Each gets a default row saying "not confirmed";
--     only the owner's own signed row (`confirmed`) lets the eyes read it
--     (PENDING 49). The guard of migration 277 refuses any other signature.
-- =============================================================================

INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order, supplies_source_type)
VALUES
  ('cp_etsy_marketplace_search', 'read_marketplace_listings', 'etsy_marketplace_search', 'api', NULL,
   'nothing - the application key the owner placed; no account, no purchase', 'declared', 17, 'marketplace'),
  ('cp_stack_exchange', 'read_community_discussion', 'stack_exchange', 'api', NULL,
   'nothing - public, no credential; a few hundred requests a day without a key', 'declared', 18, 'community');

INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by) VALUES
  ('f3_terms_ddg', NULL, 'source_terms:duckduckgo_autocomplete', 'policy', 'not_confirmed',
   'DuckDuckGo publishes no term licensing a program to call its suggestion endpoint; whether Foundry may is his to confirm (PENDING 49)',
   'owner_decision:pending:49'),
  ('f3_terms_etsy_search', NULL, 'source_terms:etsy_marketplace_search', 'policy', 'not_confirmed',
   'whether Etsy''s API terms let a seller''s application read other shops'' listings for research is not settled; his to confirm (PENDING 49)',
   'owner_decision:pending:49');
