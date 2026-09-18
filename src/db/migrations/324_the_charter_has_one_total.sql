-- =============================================================================
-- THE CHARTER HAS ONE TOTAL.
--
-- Migration 319 bounded the studio's money per CALENDAR MONTH, and thinking per
-- calendar day. That is enforceable and honest, and it is not what a person
-- reads. Ninety days signed in the middle of a month touch four calendar
-- months, so "a hundred dollars a month" authorised four hundred on tests, and
-- some thirty-day window could hold two months' ceilings. A ceiling that moves
-- with the calendar is a ceiling the owner cannot hold in his head.
--
-- So what he signs is a TOTAL for the whole charter: so much for tests, over
-- these days, plus so much thinking a day. The total is a row guard with no
-- calendar in it — carves for this charter may never exceed it, whatever month
-- they fall in — and the true maximum is that total plus the day's thinking
-- across the term. No day, no month and no window can exceed it.
--
-- `monthly_cents` stays, written equal to the total, so 319's month clause is
-- subsumed and can never bind before the charter clause. It is no longer an
-- owner-facing idea.
--
-- Nothing in production has been signed, so the default of zero never reaches
-- a live charter; the guard below refuses it if it ever tried.
-- =============================================================================

ALTER TABLE portfolio_envelopes ADD COLUMN tests_total_cents INTEGER NOT NULL DEFAULT 0;

-- A CHECK cannot be added to an existing table, and the guard is where the
-- refusals already live, in the owner's words.
DROP TRIGGER portfolio_envelope_guard;
CREATE TRIGGER portfolio_envelope_guard
BEFORE INSERT ON portfolio_envelopes
BEGIN
  SELECT RAISE(ABORT,'portfolio_envelope:incomplete')
    WHERE trim(NEW.contact_rules) = '' OR trim(NEW.public_voice) = '' OR trim(NEW.statement) = '';
  -- THE OWNER SIGNS. Not the institution, not a hand, not another founder.
  SELECT RAISE(ABORT,'portfolio_envelope:only_the_owner_signs')
    WHERE NEW.signed_by <> 'founder:' || NEW.founder_id;
  SELECT RAISE(ABORT,'portfolio_envelope:cannot_arrive_withdrawn')
    WHERE NEW.withdrawn_at IS NOT NULL OR NEW.withdraw_reason IS NOT NULL;
  -- IT ENDS. Ninety-two days is a quarter with room for a long month; standing
  -- authority he has not looked at for longer than that is not standing.
  SELECT RAISE(ABORT,'portfolio_envelope:must_end_within_a_quarter')
    WHERE datetime(NEW.expires_at) <= datetime(NEW.signed_at)
       OR datetime(NEW.expires_at) > datetime(NEW.signed_at, '+92 days');
  -- ONE LIVE CHARTER PER OWNER. Two envelopes is no envelope.
  SELECT RAISE(ABORT,'portfolio_envelope:already_one')
    WHERE EXISTS (SELECT 1 FROM portfolio_envelopes e
                   WHERE e.founder_id = NEW.founder_id AND e.withdrawn_at IS NULL
                     AND datetime(e.expires_at) > datetime('now'));
  -- THE TOTAL IS THE BOUND, and the month may never be looser than the whole.
  -- Last, so every refusal 319 already made is still made in its own words.
  SELECT RAISE(ABORT,'portfolio_envelope:needs_a_total')
    WHERE NEW.tests_total_cents <= 0 OR NEW.tests_total_cents < NEW.monthly_cents;
END;

DROP TRIGGER portfolio_envelope_withdraw_is_one_way;
CREATE TRIGGER portfolio_envelope_withdraw_is_one_way
BEFORE UPDATE ON portfolio_envelopes
BEGIN
  SELECT RAISE(ABORT,'portfolio_envelope:already_withdrawn')
    WHERE OLD.withdrawn_at IS NOT NULL;
  SELECT RAISE(ABORT,'portfolio_envelope:withdraw_needs_reason')
    WHERE NEW.withdrawn_at IS NOT NULL AND trim(coalesce(NEW.withdraw_reason,'')) = '';
  -- What he signed is what he signed. A wider envelope is a new signature.
  SELECT RAISE(ABORT,'portfolio_envelope:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id
       OR NEW.monthly_cents IS NOT OLD.monthly_cents
       OR NEW.tests_total_cents IS NOT OLD.tests_total_cents
       OR NEW.probes_in_flight IS NOT OLD.probes_in_flight
       OR NEW.cognition_cents_per_day IS NOT OLD.cognition_cents_per_day
       OR NEW.contact_rules IS NOT OLD.contact_rules
       OR NEW.public_voice IS NOT OLD.public_voice
       OR NEW.statement IS NOT OLD.statement
       OR NEW.signed_by IS NOT OLD.signed_by
       OR NEW.signed_at IS NOT OLD.signed_at
       OR NEW.expires_at IS NOT OLD.expires_at;
END;

-- The carve guard, with the whole-charter clause ahead of the month's. Every
-- other clause is 319's, verbatim. It reads the index that already exists.
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
  -- THE PLACES IN FLIGHT. A carved test counts until it has an answer, is
  -- retired, invalidated or superseded.
  SELECT RAISE(ABORT,'portfolio_envelope_carve:no_room_in_flight')
    WHERE (
      SELECT count(*) FROM portfolio_envelope_carves c
        JOIN venture_experiments x ON x.id = c.experiment_id
       WHERE c.envelope_id = NEW.envelope_id
         AND x.what_happened IS NULL AND x.retired_at IS NULL
         AND x.validity = 'valid' AND x.superseded_by IS NULL
         AND coalesce(x.decision, '') <> 'declined')
      >= (SELECT e.probes_in_flight FROM portfolio_envelopes e WHERE e.id = NEW.envelope_id);
END;
