-- =============================================================================
-- WHAT THE VENUE ITSELF SAYS ABOUT WHETHER THE SHOP IS OPEN.
--
-- Migration 353 asked the owner whether buyers can find the shop, because
-- nothing read from Etsy could answer it. That was half true. Etsy's shop
-- resource carries `is_vacation`, and a shop on vacation takes no orders. The
-- reader fetched that resource on every read and dropped the field. Developer
-- Mode, which is what actually hid ApexMicro, is not reported to apps; his word
-- stays the only witness of that, and this table does not replace it.
--
-- Each row is one change in what the venue reported, as the venue's, when it
-- was read. A field the venue did not send is no row at all, never "open".
-- The same state read again is not a new fact, and nothing rewrites a reading.
-- Every row is the venue's by construction: the owner's word lives in
-- venue_findability, and nothing else writes here.
-- =============================================================================

CREATE TABLE venue_visibility_readings (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  provider     TEXT NOT NULL CHECK (provider = lower(provider) AND length(provider) > 0),
  on_vacation  INTEGER NOT NULL CHECK (on_vacation IN (0, 1)),
  observed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX venue_visibility_readings_by_shop ON venue_visibility_readings (product_id, provider, observed_at);

-- Read is read.
CREATE TRIGGER venue_visibility_readings_are_as_read
BEFORE UPDATE ON venue_visibility_readings
BEGIN SELECT RAISE(ABORT, 'venue_visibility_readings:read_is_read'); END;
