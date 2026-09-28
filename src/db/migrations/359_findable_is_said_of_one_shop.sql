-- =============================================================================
-- 359 — WHAT HE SAID ABOUT ONE SHOP IS ABOUT THAT SHOP.
--
-- Roadmap G4: a past qualification is never inherited when the account
-- changes. `venue_findability` (353) was keyed by company and venue, so his
-- word that buyers can find ApexMicro would have counted for a different Etsy
-- shop connected later. Each statement now carries the venue account that was
-- confirmed as his when he said it, and only statements about the shop
-- connected now — or said before this column existed — are read as his word
-- about it (`findabilityOf`).
--
-- NULL means no confirmed shop was named when it was said. Rows made before
-- this migration are all NULL, and keep counting as they did.
-- =============================================================================

ALTER TABLE venue_findability ADD COLUMN account_ref TEXT;
