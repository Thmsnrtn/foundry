-- =============================================================================
-- TELL SEARCH ENGINES A WORKSHOP PAGE CHANGED (Roadmap 2027 R38).
--
-- Announcing a page is part of publishing it, so the IndexNow tool is bound to
-- the capability that already publishes a page at the Workshop's own address.
-- No new capability, rung or authority: it acts only where the page itself
-- may, through the same door, under the same boundaries and kill switch.
-- =============================================================================
INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_public_page_indexnow', 'publish_public_page', 'indexnow', 'api', 'indexnow_submit', 'none', 'available', 2);
