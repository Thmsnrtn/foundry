-- =============================================================================
-- 363 — WHICH FILE EACH BUYER RECEIVED.
--
-- The owner's handoff of 28 September: bind the sold-order version, so a
-- correction can trace the buyers it affects and never replaces the
-- historical promise invisibly. A venue order keeps the files its listing held
-- at the last reading at or before it was paid (`venue_listing_readings`,
-- migrations 356–357), as the venue reported them.
--
-- NULL means no reading came before the sale: which file the buyer received is
-- not known, and nothing is inferred. Written once, when the order is recorded.
-- =============================================================================

ALTER TABLE experiment_fulfilments ADD COLUMN delivered_files_json TEXT
  CHECK (delivered_files_json IS NULL OR json_valid(delivered_files_json));
ALTER TABLE experiment_fulfilments ADD COLUMN delivered_files_seen_at TEXT;
