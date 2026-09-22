-- =============================================================================
-- READING YOUR OWN SHOP IS NOT A HAND.
--
-- The owner asked for "the first genuinely qualified external operating
-- capability", proved by "the smallest legitimate, controlled real-account
-- qualification sequence" — and, in the same breath, that Foundry not "publish
-- the workbook or incur listing fees merely to establish that the integration
-- works". Reading is the whole of what can honestly be proven without
-- publishing, and it happens to be the half that matters most: an experiment
-- whose venue nobody can read is an experiment whose silence means nothing.
--
-- WHY A NEW CAPABILITY RATHER THAN `read_marketplace_listings`. That one exists
-- and is classified `public_observation` (migration 266) — a page anybody may
-- fetch, with no account. This is the opposite: a private account reachable
-- only with something the owner connected. Reusing the public key would have
-- let a credentialed read inherit a basis that says no credential is involved,
-- which is the kind of quiet category error this schema exists to prevent.
--
-- FAMILY `commerce`, AND THE CHOICE IS LOAD-BEARING. Not `distribution`:
-- `qualificationStandsInTheWay` falls back to the capability's family when no
-- act names a crossing, and gates `distribution` as the family of putting
-- something in front of people. Reading a shop puts nothing in front of
-- anybody. A test that is not ready must still be readable — indeed it is
-- exactly when a test is not ready that somebody most needs to look at it.
--
-- RUNG `observe`, WHICH IS THE CEILING AND NOT A HOPE. This capability's
-- provider is bound to a tool that reads and cannot write: the scopes are
-- constitutional and `listings_w` is in none of them, so the credential this
-- acts through is incapable of the acts `draft_on_marketplace`,
-- `upload_product_file` and `list_on_marketplace` name. Those three keep
-- `tool = NULL` and are untouched here.
--
-- BASIS `owner_connected`, WHICH IS ONE ACT ONCE AND NOT ONE PER LOOK. What he
-- grants is the eye; ordinary looking through it afterwards does not consume
-- per-act authority. `never_grants` says in his own terms what the eye is not.
-- =============================================================================

DROP TRIGGER capabilities_constitutional_insert;

INSERT INTO capabilities (capability_key, family, what_it_does, rung, draws_on_allowance, sort_order) VALUES
  ('read_marketplace_account', 'commerce',
   'read the shop this institution sells through — which shop it is, what is listed, and the orders and fees the venue reported',
   'observe', 0, 96);

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

INSERT INTO capability_access
  (capability_key, basis, why, needs_credential, may_cost_cents, never_grants, established_by)
VALUES
  ('read_marketplace_account', 'owner_connected',
   'a seller account that only exists to him, reachable only with a connection he made',
   1, 0,
   'creating, changing, publishing or withdrawing a listing, uploading a file, spending anything, '
   || 'or contacting a buyer',
   'institution:constitutional');

-- WHO WOULD DO IT, AND AT THE ONLY MATURITY A NEW PROVIDER MAY ARRIVE AT.
-- `declared` is the floor, and the guard refuses anything above `available` on
-- arrival regardless: proof is earned by a witnessed change, never asserted by
-- the migration that creates the row.
--
-- AND IT CARRIES NO TOOL EITHER, WHICH IS THE COLUMN MEANING WHAT IT SAYS.
-- `capability_providers.tool` is "the name at the outbound door, when this goes
-- through it. NULL means it never reaches the world on its own (a read, a
-- draft, a workspace step)." A read causes no external effect, so it has no
-- business at a door built for mutations — and every other eye in this
-- institution already works that way: the package registry, the community
-- archives and the rest read through `safeFetch` and are classified
-- `read_only` by the effects audit.
--
-- The first draft of this migration gave the reader a tool, on the reasoning
-- that an audit row would be nice to have. That would have made this column
-- mean two different things in two rows of the same table, which is how a
-- schema stops being able to answer a question. The audit of a read belongs in
-- `market_retrievals`, where this institution already records what it asked, of
-- whom, and what came back.
INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_etsy_read', 'read_marketplace_account', 'etsy', 'api', NULL,
   'nothing; Etsy charges a seller nothing to read their own shop through its API',
   'declared', 1);
