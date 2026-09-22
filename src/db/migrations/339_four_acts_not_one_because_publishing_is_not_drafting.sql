-- =============================================================================
-- FOUR ACTS, NOT ONE, BECAUSE PUBLISHING IS NOT DRAFTING.
--
-- Etsy's own documentation settles the shape of this. Putting a digital
-- download on sale is four calls, and they do not have the same consequence:
--
--   POST   .../listings          createDraftListing   nothing is public
--   POST   .../listings/{id}/files   uploadListingFile    nothing is public
--   POST   .../listings/{id}/images  uploadListingImage   nothing is public
--   PATCH  .../listings/{id}     state = active       PUBLIC, and it charges
--
-- The owner's instruction is that "a browser being able to create a listing
-- does not establish permission to publish it" and that authority must stay
-- distinct for creating or editing listings, publishing public content, and
-- spending money or incurring recurring fees. That is not a principle this
-- schema has to be taught: it is what `capabilities.rung` already means. So
-- the three preparing steps are `prepare` and the activation is the existing
-- `list_on_marketplace` at `public` — three different permissions, and an
-- approval of one is no approval of another.
--
-- AND ACTIVATION SPENDS MONEY. Etsy's fee page, already recorded as an
-- observation against this test, says $0.20 per listing for four months,
-- renewing at $0.20 on each sale. That is small and it is real, and a
-- capability that charges the owner without an allowance covering a declared
-- amount is exactly what `draws_on_allowance` exists to stop. It was not set
-- on `list_on_marketplace`, because when 261 chose its four nothing could list
-- anything. Something can now.
--
-- NOTHING HERE CAN ACT. Every provider row is `declared` with `tool = NULL`,
-- which in this schema is precise rather than cautious: `consequenceAllows`
-- refuses a tool bound to nothing, and a capability with no tool has no door
-- to arrive at. No handler is registered and no credential exists. What this
-- migration buys is that the acts are NAMED and GRADED before anybody writes
-- the code that performs them, so the code is judged by a row it did not get
-- to choose.
--
-- Constitutional, so the guards come off for these statements and go straight
-- back on.
-- =============================================================================

DROP TRIGGER capabilities_constitutional_insert;
DROP TRIGGER capabilities_constitutional_update;

INSERT INTO capabilities (capability_key, family, what_it_does, rung, draws_on_allowance, sort_order) VALUES
  ('draft_on_marketplace', 'distribution',
   'compose a listing on a marketplace that nobody can see yet', 'prepare', 0, 115),
  ('upload_product_file', 'distribution',
   'put the file a customer would download onto the marketplace', 'prepare', 0, 116);

-- The fee is the reason. Activation is the first step that costs anything, and
-- an amount has to be declared and covered before it does.
UPDATE capabilities SET draws_on_allowance = 1 WHERE capability_key = 'list_on_marketplace';

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;
CREATE TRIGGER capabilities_constitutional_update BEFORE UPDATE ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

-- WHO WOULD DO IT, AT THE MATURITY IT HAS HONESTLY REACHED. `declared` is the
-- floor and the guard refuses anything above `available` on arrival anyway.
-- `tool` is NULL on every one: they cannot reach the world, and the day one of
-- them can will be a migration that says so and a handler somebody reviewed.
INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_etsy_draft',    'draft_on_marketplace', 'etsy', 'api', NULL,
   'nothing; a draft is free until it is activated', 'declared', 1),
  ('cp_etsy_file',     'upload_product_file',  'etsy', 'api', NULL,
   'nothing', 'declared', 1),
  ('cp_etsy_activate', 'list_on_marketplace',  'etsy', 'api', NULL,
   '$0.20 per listing for four months, renewing at $0.20 on each sale, plus 6.5% transaction and 3% + $0.25 processing on anything it sells',
   'declared', 1);
