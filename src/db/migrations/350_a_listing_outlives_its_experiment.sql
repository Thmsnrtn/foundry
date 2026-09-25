-- =============================================================================
-- A LISTING OUTLIVES ITS EXPERIMENT.
--
-- `settleListings` withdraws the Foundry exposure the moment an experiment
-- settles — correctly: the sealed prediction is done, and nothing may write to
-- its evidence again. `recordVenueOrder` then refuses any further order against
-- that withdrawn exposure — also correctly: `not_listed` is the true state.
--
-- But withdrawing FOUNDRY'S OWN BOOKKEEPING does not take the listing down at
-- Etsy. That is the owner's act, and until he takes it a stranger can still
-- pay. Before this migration the refusal above was caught, logged, and
-- forgotten: `etsy-shop.ts`'s order loop wrote it into the operator log beside
-- routine noise, where a real paid order and a bug in this institution read
-- identically. A log a nobody reads is not a durable fact, and the owner never
-- saw either the money or the gap.
--
-- WHAT THIS IS NOT. It is not a ledger row: no charge, no fee, no fulfilment,
-- no obligation is written here, and nothing in `unitContribution`, `burden.ts`
-- or any owner-facing money figure reads this table. Folding a post-settlement
-- order into the concluded experiment's own counts would be fabricating
-- economic evidence — `reached` and `purchases` are sealed with the
-- prediction. Recording it as a real transaction under the CONTINUING asset is
-- its own, larger piece of work (an asset-scoped intake path) and is not done
-- here. This is the smaller, honest half: SEE IT, AND SAY IT.
--
-- DEDUPLICATED ON THE VENUE'S OWN ORDER NUMBER, so an hourly read that keeps
-- finding the same unresolved receipt raises this once, not once an hour.
-- =============================================================================

CREATE TABLE venue_orders_after_settlement (
  id               TEXT PRIMARY KEY,
  founder_id       TEXT NOT NULL REFERENCES founders(id),
  experiment_id    TEXT NOT NULL REFERENCES venture_experiments(id),
  -- The asset this listing belonged to, read at the moment this row is
  -- written. Not a live join: the asset can be archived later, and the row
  -- must still say which one this order was about.
  product_id       TEXT REFERENCES products(id),
  provider         TEXT NOT NULL,
  -- The venue's own order number. Not a Foundry reference: nothing here has
  -- recorded this order, which is the entire reason the row exists.
  order_ref        TEXT NOT NULL,
  gross_cents      INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  paid_at          TEXT NOT NULL,
  observed_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_mode    TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  -- WHAT THIS ROW CANNOT YET SAY, named on the row rather than assumed: a
  -- payment with no fee read, no delivery confirmed, no obligation opened.
  unknown          TEXT NOT NULL,
  resolved_at      TEXT,
  resolved_because TEXT
);

CREATE UNIQUE INDEX idx_venue_order_after_settlement_once
  ON venue_orders_after_settlement(provider, order_ref);

CREATE INDEX idx_venue_orders_after_settlement_open
  ON venue_orders_after_settlement(founder_id) WHERE resolved_at IS NULL;

CREATE TRIGGER venue_order_after_settlement_guard
BEFORE INSERT ON venue_orders_after_settlement
BEGIN
  SELECT RAISE(ABORT,'venue_order_after_settlement:incomplete')
    WHERE trim(NEW.order_ref) = '' OR trim(NEW.provider) = '' OR trim(NEW.unknown) = '';
  SELECT RAISE(ABORT,'venue_order_after_settlement:bad_amount')
    WHERE NEW.gross_cents <= 0;
  SELECT RAISE(ABORT,'venue_order_after_settlement:cannot_arrive_resolved')
    WHERE NEW.resolved_at IS NOT NULL OR NEW.resolved_because IS NOT NULL;
END;

-- RESOLVED ONCE, WITH A REASON, LIKE EVERY OTHER OPEN QUESTION IN THIS
-- INSTITUTION (`market_unknowns.answered_at`, `company_situations.ended_at`).
-- Nothing else on the row may move: it is the venue's own statement of what
-- happened, not a working draft.
CREATE TRIGGER venue_order_after_settlement_resolved_once
BEFORE UPDATE ON venue_orders_after_settlement
BEGIN
  SELECT RAISE(ABORT,'venue_order_after_settlement:already_resolved')
    WHERE OLD.resolved_at IS NOT NULL;
  SELECT RAISE(ABORT,'venue_order_after_settlement:resolve_needs_reason')
    WHERE NEW.resolved_at IS NOT NULL AND trim(coalesce(NEW.resolved_because,'')) = '';
  SELECT RAISE(ABORT,'venue_order_after_settlement:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id
       OR NEW.experiment_id IS NOT OLD.experiment_id
       OR NEW.provider IS NOT OLD.provider
       OR NEW.order_ref IS NOT OLD.order_ref
       OR NEW.gross_cents IS NOT OLD.gross_cents
       OR NEW.currency IS NOT OLD.currency
       OR NEW.paid_at IS NOT OLD.paid_at
       OR NEW.unknown IS NOT OLD.unknown;
END;

-- IMMUTABLE DURING ORDINARY OPERATION, NOT AGAINST ITS OWN KEEPER'S ERASURE.
-- An unconditional refusal here is exactly the bug migration 335 already
-- named once: a record made undeletable gives the founder-erasure sweep an
-- abort it cannot retry past, and the sweep aborts as a whole rather than
-- skipping the one row — `company_situations_no_delete` is the pattern this
-- mirrors. `product_id` is nullable on this table; with no product to protect,
-- there is nothing for this guard to stand in front of.
CREATE TRIGGER venue_order_after_settlement_no_delete
BEFORE DELETE ON venue_orders_after_settlement
BEGIN
  SELECT RAISE(ABORT,'venue_order_after_settlement:immutable')
    WHERE OLD.product_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM products p WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;
