-- =============================================================================
-- A SUBSCRIPTION CAN ALWAYS BE STOPPED.
--
-- The owner decided subscriptions may be tested (PENDING 31) and lifts the
-- first-proof rule against recurring billing themselves, on Control (R17). The
-- exchange becomes available in this change because the institution can now
-- run it the whole way round — and the part that matters most is the end:
-- every week's email carries a signed link that stops future charges, and a
-- test that ends stops every subscription it started. Nothing recurs that
-- cannot be stopped.
--
-- Which subscription a paid week belongs to is kept on the week itself, read
-- from the invoice at intake; a cancellation is a row of its own, so who asked,
-- when, and whether the provider took it is on record rather than in a log.
-- =============================================================================
ALTER TABLE experiment_fulfilments ADD COLUMN subscription_ref TEXT;

CREATE TABLE subscription_cancellations (
  id               TEXT PRIMARY KEY,
  founder_id       TEXT NOT NULL REFERENCES founders(id),
  experiment_id    TEXT NOT NULL REFERENCES venture_experiments(id),
  fulfilment_id    TEXT NOT NULL REFERENCES experiment_fulfilments(id),
  subscription_ref TEXT NOT NULL,
  -- The buyer, by the link in a delivery; or the test, because it ended.
  asked_by         TEXT NOT NULL CHECK (asked_by IN ('buyer', 'test_ended')),
  asked_at         TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at     TEXT,
  refused_reason   TEXT,
  UNIQUE (experiment_id, subscription_ref)
);

UPDATE probe_exchanges SET available = 1 WHERE exchange = 'subscription';
