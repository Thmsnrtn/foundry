-- =============================================================================
-- THE FILES ON A TEST'S LISTING, AS THE VENUE HOLDS THEM.
--
-- A download listing delivers whatever file the owner uploaded by hand. Etsy's
-- getAllListingFiles (read scope, already granted) returns each file's name
-- and size in bytes, and no hash, so name and size are the most that can be
-- compared with the file Foundry built.
--
-- NULL means the files were not read on that pass; '[]' means the venue held
-- none. A change in the files is a new row, like any other change in what the
-- venue shows, and the trigger from migration 356 keeps every row as read.
-- =============================================================================

ALTER TABLE venue_listing_readings ADD COLUMN files_json TEXT
  CHECK (files_json IS NULL OR json_valid(files_json));
