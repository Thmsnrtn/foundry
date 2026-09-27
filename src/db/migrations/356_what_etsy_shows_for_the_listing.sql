-- =============================================================================
-- WHAT THE VENUE SHOWS FOR A TEST'S LISTING.
--
-- A listing test seals a prediction about one offer: this file, at this price.
-- The owner places the listing himself and pastes its address, and nothing
-- checked that what the venue then shows is that offer. A different price, or
-- a listing that expired out of the shop, tests something else or nothing.
--
-- Each row is one change in what a complete read of the shop showed for the
-- listing: among its active listings or not, and at what price. "Not seen" is
-- written only from a read that reached every listing the venue said it had.
-- The same thing read again is not a new fact, and nothing rewrites a reading.
-- =============================================================================

CREATE TABLE venue_listing_readings (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  provider     TEXT NOT NULL CHECK (provider = lower(provider) AND length(provider) > 0),
  listing_id   TEXT NOT NULL CHECK (length(listing_id) > 0),
  seen         INTEGER NOT NULL CHECK (seen IN (0, 1)),
  price_cents  INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency     TEXT CHECK (currency IS NULL OR currency = lower(currency)),
  observed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (seen = 1 OR (price_cents IS NULL AND currency IS NULL))
);

CREATE INDEX venue_listing_readings_by_listing ON venue_listing_readings (product_id, provider, listing_id, observed_at);

CREATE TRIGGER venue_listing_readings_are_as_read
BEFORE UPDATE ON venue_listing_readings
BEGIN SELECT RAISE(ABORT, 'venue_listing_readings:read_is_read'); END;
