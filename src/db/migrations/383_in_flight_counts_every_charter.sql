-- =============================================================================
-- IN FLIGHT COUNTS EVERY TEST, WHICHEVER CHARTER LET IT IN (Roadmap 2027 R52).
--
-- The owner signs a number of tests in flight. A renewal withdraws the
-- standing charter and writes a new one, and the carve guard counted only the
-- new charter's carves, so renewing with tests still running opened every
-- place again: six running against a signed three.
--
-- The guard is recreated with every clause of 324's verbatim except the one
-- that counts places, which now counts the owner's unsettled carves under any
-- of their charters. Money is untouched: each signature is its own total, and
-- the money clauses still read this charter's carves alone.
-- =============================================================================
DROP TRIGGER portfolio_envelope_carve_guard;
CREATE TRIGGER portfolio_envelope_carve_guard
BEFORE INSERT ON portfolio_envelope_carves
BEGIN
  -- Only a live charter can be carved, and only for its own owner's test.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:no_live_charter')
    WHERE NOT EXISTS (
      SELECT 1 FROM portfolio_envelopes e
        JOIN venture_experiments x ON x.founder_id = e.founder_id
       WHERE e.id = NEW.envelope_id AND x.id = NEW.experiment_id
         AND e.withdrawn_at IS NULL AND datetime(e.expires_at) > datetime('now'));
  -- The asset is the one the test made when it was approved; a test has no
  -- asset column of its own, the asset points back at it.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:not_this_tests_asset')
    WHERE NOT EXISTS (
      SELECT 1 FROM products p
       WHERE p.id = NEW.product_id AND p.from_experiment_id = NEW.experiment_id);
  -- One carve per test: a probe is let in once.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:already_carved')
    WHERE EXISTS (SELECT 1 FROM portfolio_envelope_carves c WHERE c.experiment_id = NEW.experiment_id);
  -- THE CHARTER'S MONEY, WHOLE. This carve plus every carve ever made under
  -- this charter may not exceed the total he signed. No calendar appears here,
  -- which is the point: the same sum bounds any day, any month and the term.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:over_the_charter')
    WHERE NEW.cents + (
      SELECT coalesce(SUM(c.cents), 0) FROM portfolio_envelope_carves c
       WHERE c.envelope_id = NEW.envelope_id)
      > (SELECT e.tests_total_cents FROM portfolio_envelopes e WHERE e.id = NEW.envelope_id);
  -- THE MONTH'S MONEY, kept from 319. The total is written into it, so this
  -- can never bind before the clause above; it stands as the older bound.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:over_the_month')
    WHERE NEW.cents + (
      SELECT coalesce(SUM(c.cents), 0) FROM portfolio_envelope_carves c
       WHERE c.envelope_id = NEW.envelope_id
         AND strftime('%Y-%m', c.carved_at) = strftime('%Y-%m', 'now'))
      > (SELECT e.monthly_cents FROM portfolio_envelopes e WHERE e.id = NEW.envelope_id);
  -- THE PLACES IN FLIGHT, ACROSS EVERY CHARTER OF HIS (383). A carved test
  -- counts until it has an answer, is retired, invalidated or superseded,
  -- whichever of his charters let it in.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:no_room_in_flight')
    WHERE (
      SELECT count(*) FROM portfolio_envelope_carves c
        JOIN portfolio_envelopes ce ON ce.id = c.envelope_id
        JOIN venture_experiments x ON x.id = c.experiment_id
       WHERE ce.founder_id = (SELECT e.founder_id FROM portfolio_envelopes e WHERE e.id = NEW.envelope_id)
         AND x.what_happened IS NULL AND x.retired_at IS NULL
         AND x.validity = 'valid' AND x.superseded_by IS NULL
         AND coalesce(x.decision, '') <> 'declined')
      >= (SELECT e.probes_in_flight FROM portfolio_envelopes e WHERE e.id = NEW.envelope_id);
END;
