-- Migration 118: authenticated append-only owner disposition on institutional
-- judgments.
--
-- Constitutional boundary: an owner's direction is NOT execution authority.
-- "I agree with the recommendation" never means "Foundry may perform every
-- implied action". This ledger therefore has no consent, scope, capability,
-- consequence, expiry, action, or execution column: there is nothing here for
-- a later authority lookup to read. Responsibility-bound authority continues to
-- require the exact migration-112 `autonomy_consents` grant and nothing else.
--
-- The judgment row itself is never rewritten. Disposition is appended beside
-- the judgment so that what Foundry knew and recommended at the time survives
-- the owner later agreeing, disagreeing, deferring, or changing their mind.
CREATE TABLE institutional_judgment_dispositions (
  id                   TEXT PRIMARY KEY,
  judgment_id          TEXT NOT NULL REFERENCES strategic_decisions_log(id),
  product_id           TEXT NOT NULL,
  owner_id             TEXT NOT NULL,
  disposition          TEXT NOT NULL CHECK (disposition IN
                         ('accepted','rejected','deferred','alternative_selected')),
  selected_alternative TEXT,
  reason               TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_judgment_dispositions ON institutional_judgment_dispositions(product_id,judgment_id,created_at);

CREATE TRIGGER institutional_judgment_disposition_guard
BEFORE INSERT ON institutional_judgment_dispositions
BEGIN
  -- Only a real institutional judgment of this product may be dispositioned.
  -- A generic strategic decision row carries none of the responsibility and
  -- evidence provenance this contract governs.
  SELECT RAISE(ABORT,'judgment_disposition:judgment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM strategic_decisions_log d
    WHERE d.id=NEW.judgment_id AND d.product_id=NEW.product_id
      AND d.responsibility_refs_json IS NOT NULL);

  -- Session-derived identity is verified against the real product owner. A
  -- caller-supplied owner string cannot establish its own authority.
  SELECT RAISE(ABORT,'judgment_disposition:owner_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.owner_id=NEW.owner_id);

  SELECT RAISE(ABORT,'judgment_disposition:reason_required') WHERE trim(NEW.reason)='';

  -- A selected alternative must be one Foundry actually represented at
  -- judgment time; the owner cannot introduce an unrepresented direction here.
  SELECT RAISE(ABORT,'judgment_disposition:alternative_invalid') WHERE
    (NEW.disposition='alternative_selected' AND (NEW.selected_alternative IS NULL OR NOT EXISTS (
      SELECT 1 FROM strategic_decisions_log d, json_each(d.alternatives_considered_json) alt
      WHERE d.id=NEW.judgment_id AND alt.value=NEW.selected_alternative)))
    OR (NEW.disposition<>'alternative_selected' AND NEW.selected_alternative IS NOT NULL);
END;

-- History is append-only: a later change of direction is a new row, never an
-- edit or deletion of the earlier one.
CREATE TRIGGER institutional_judgment_disposition_append_only_update
BEFORE UPDATE ON institutional_judgment_dispositions
BEGIN
  SELECT RAISE(ABORT,'judgment_disposition:append_only');
END;

CREATE TRIGGER institutional_judgment_disposition_append_only_delete
BEFORE DELETE ON institutional_judgment_dispositions
BEGIN
  SELECT RAISE(ABORT,'judgment_disposition:append_only');
END;
