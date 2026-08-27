-- =============================================================================
-- Migration 219: a channel that says what feeds it
--
-- `support_channels` binds a responsibility to an intake key, and the only way
-- a message could arrive was somebody POSTing JSON to that key by hand. The
-- design record has always said the missing piece is a caller: "an adapter for
-- a helpdesk, a mailbox, or a form is an ordinary caller." None existed, so the
-- support responsibility could be understood and shadowed and never assisted
-- with a real customer's words.
--
-- WHICH RESPONSIBILITY A MESSAGE BELONGS TO IS NOT SOMETHING FOUNDRY MAY GUESS.
-- A product can hold several support channels, each bound to a different
-- responsibility. An adapter that picked one would be inventing the linkage
-- migration 126 forbids — "the founder states the kind explicitly, and
-- ambiguity stays conversation". So the FOUNDER says which channel a provider
-- feeds, and `fed_by` is that statement. NULL is the ordinary case: a channel
-- somebody posts to themselves.
--
-- The partial unique index is the whole point of the column. Two live channels
-- both claiming Intercom would put Foundry back to choosing, and the adapter
-- would have to guess or refuse at run time. It cannot happen: the database
-- refuses the second one, and a revoked channel does not hold the claim.
--
-- The vocabulary is closed and currently has one member. A provider gets added
-- here when an adapter for it exists, which is the same rule the API scopes
-- follow: nothing may be offered that no code honours.
-- =============================================================================

ALTER TABLE support_channels ADD COLUMN fed_by TEXT
  REFERENCES support_channel_feeds(provider);

CREATE TABLE IF NOT EXISTS support_channel_feeds (
  provider TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO support_channel_feeds (provider) VALUES ('intercom');

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_channels_one_feed_per_provider
  ON support_channels(product_id, fed_by)
  WHERE fed_by IS NOT NULL AND revoked_at IS NULL;
