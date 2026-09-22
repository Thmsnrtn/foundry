-- =============================================================================
-- WHO SAW IT, AND WHO CAN PUT IT RIGHT.
--
-- The owner: "Distinguish an obligation independently observed by Foundry, an
-- obligation reported by a marketplace, an obligation inferred from incomplete
-- evidence, a possible obligation that Foundry cannot currently observe, and an
-- obligation requiring the owner's manual action from one Foundry can fulfil
-- within existing authority." And: "Do not infer that Etsy handles every
-- possible customer responsibility or that Apex Micro has none."
--
-- Nothing in `experiment_fulfilments` said how a row got there. `provider`
-- names the venue, which is a different question: a Stripe charge Foundry read
-- from a webhook and an Etsy order the owner typed off a statement are the
-- same shape of row and nothing distinguishes the evidence behind them. That
-- matters because it decides what silence means. A channel Foundry watches
-- that reports nothing is evidence of nothing happening; a channel it cannot
-- read that reports nothing is evidence of nothing at all.
--
-- `observed_how` is the smallest durable fact that closes it, and it is one
-- column rather than a second ledger.
--
--   foundry_observed — a provider Foundry watches told it, unprompted
--   venue_reported   — the venue's own record, read through a connection
--   owner_entered    — he typed it off a statement; true, and only as complete
--                      as his attention
--   inferred         — derived from incomplete evidence and not confirmed
--
-- BACKFILLED BY PROVIDER, WHICH IS THE HONEST READING OF HISTORY. Stripe rows
-- arrived through the webhook Foundry listens to. Everything else on this
-- deployment arrived through `recordVenueOrder`, which is the owner at a
-- keyboard with a statement open.
-- =============================================================================

ALTER TABLE experiment_fulfilments ADD COLUMN observed_how TEXT NOT NULL DEFAULT 'foundry_observed'
  CHECK (observed_how IN ('foundry_observed','venue_reported','owner_entered','inferred'));

UPDATE experiment_fulfilments SET observed_how = 'owner_entered' WHERE provider <> 'stripe';
