-- =============================================================================
-- WHETHER BUYERS CAN FIND THE SHOP, AS THE OWNER SAID IT.
--
-- On 25 September 2026 the owner found Etsy's notice on his shop: it was in
-- Developer Mode, which "makes your shop's listings not discoverable via
-- search". Nothing here could have seen it. The reader asks Etsy which shop,
-- what is listed and what was paid; it never asks whether a buyer can find
-- any of it, and Etsy is not known to tell an app that a shop is hidden.
--
-- A listing test in a hidden shop closes its window with no sale, and without
-- this the settlement writes "Not as predicted" about a market nobody could
-- reach — the conclusion drawn through a gap that this institution exists to
-- refuse.
--
-- So the fact is asked of the one person who can see it. Each row is one
-- thing he said, when he said it: buyers can find the shop at this venue, or
-- they cannot. The latest decides readiness; the history decides whether a
-- test's silence was a market or a hidden shop. Nothing rewrites what he
-- said, and nobody but a founder can say it — whether that founder owns the
-- company is the service's check, where it can be told to him in words.
-- =============================================================================

CREATE TABLE venue_findability (
  id          TEXT PRIMARY KEY,
  founder_id  TEXT NOT NULL REFERENCES founders(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  provider    TEXT NOT NULL CHECK (provider = lower(provider) AND length(provider) > 0),
  findable    INTEGER NOT NULL CHECK (findable IN (0, 1)),
  said_by     TEXT NOT NULL CHECK (said_by = 'founder:' || founder_id),
  said_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX venue_findability_by_shop ON venue_findability (product_id, provider, said_at);

-- Said is said.
CREATE TRIGGER venue_findability_is_as_said
BEFORE UPDATE ON venue_findability
BEGIN SELECT RAISE(ABORT, 'venue_findability:said_is_said'); END;
