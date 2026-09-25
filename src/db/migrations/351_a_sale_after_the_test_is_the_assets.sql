-- =============================================================================
-- A SALE AFTER THE TEST IS THE ASSET'S, AND SAYS SO.
--
-- Migration 350 made a paid order on a settled listing visible as an incident
-- and deliberately recorded nothing, because every canonical sale record —
-- the outcome event, the fulfilment, and through them the ledger — hangs off
-- an experiment's exposure, and every reader of a test's evidence counts
-- whatever hangs there. Writing order B the ordinary way would have raised the
-- sealed test's purchases after the fact.
--
-- The facts are simpler than a second ledger. The listing that took order B is
-- the same listing, on the same exposure; the settled experiment is the
-- asset's origin, and its life after settlement is the asset's life. What
-- separates the test's evidence from the asset's later sales is WHEN the sale
-- was recorded relative to the settlement — and a second-resolution timestamp
-- comparison is not a boundary anything should rest on. So the row carries it.
--
-- `after_settlement = 1` means: recorded after the experiment this exposure
-- belongs to had settled, as the continuing asset's, and not the test's. The
-- readers that say what a test observed exclude it; the readers that say what
-- a buyer is owed, what money moved, and what a public page must carry keep
-- counting it, because none of those is the test's business to narrow.
--
-- THE DATABASE HOLDS IT TRUE. A row may only claim to be after a settlement
-- that happened; a fulfilment says the same as the payment it belongs to; and
-- neither can be moved across the line later — the outcome event is already
-- immutable, and the fulfilment's flag is added to what may never change.
-- =============================================================================

ALTER TABLE business_outcome_events
  ADD COLUMN after_settlement INTEGER NOT NULL DEFAULT 0 CHECK (after_settlement IN (0, 1));

ALTER TABLE experiment_fulfilments
  ADD COLUMN after_settlement INTEGER NOT NULL DEFAULT 0 CHECK (after_settlement IN (0, 1));

-- Only after a settlement that happened.
CREATE TRIGGER business_outcome_after_settlement_is_true
BEFORE INSERT ON business_outcome_events
WHEN NEW.after_settlement = 1
BEGIN
  SELECT RAISE(ABORT, 'business_outcome_event:not_after_a_settlement')
   WHERE NOT EXISTS (
     SELECT 1 FROM experiment_exposures x
       JOIN venture_experiments e ON e.id = x.experiment_id
      WHERE x.id = NEW.exposure_id AND e.ran_at IS NOT NULL);
END;

-- A fulfilment is on the same side of the line as the payment it discharges.
CREATE TRIGGER experiment_fulfilment_after_settlement_matches
BEFORE INSERT ON experiment_fulfilments
BEGIN
  SELECT RAISE(ABORT, 'experiment_fulfilment:after_settlement_mismatch')
   WHERE NEW.after_settlement <> COALESCE(
     (SELECT b.after_settlement FROM business_outcome_events b WHERE b.id = NEW.payment_event_id), 0);
END;

-- And it stays there.
CREATE TRIGGER experiment_fulfilment_after_settlement_is_fixed
BEFORE UPDATE OF after_settlement ON experiment_fulfilments
WHEN NEW.after_settlement IS NOT OLD.after_settlement
BEGIN
  SELECT RAISE(ABORT, 'experiment_fulfilment:after_settlement_is_fixed');
END;
