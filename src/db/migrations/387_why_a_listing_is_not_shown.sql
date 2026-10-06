-- =============================================================================
-- WHY A TEST'S LISTING IS NOT AMONG THE SHOP'S ACTIVE ONES (Roadmap 2027 R34).
--
-- The shop's listing read returns active listings only, so an expired, sold
-- out, deactivated or draft listing read exactly like a deleted one, and the
-- owner was told it "may have expired, sold out or been deactivated". When the
-- listing is missing from a complete read, the reader now asks Etsy for that
-- one listing (read scope, already granted) and keeps the state Etsy gives;
-- 'gone' when Etsy has no listing by that number in this shop.
--
-- NULL on a row where the listing was shown, or where its state was not read.
-- A change of state is a new row; migration 356's trigger keeps every row as
-- read.
-- =============================================================================

ALTER TABLE venue_listing_readings ADD COLUMN state TEXT
  CHECK (state IS NULL OR (length(state) BETWEEN 1 AND 24 AND state NOT GLOB '*[^a-z_]*'));
