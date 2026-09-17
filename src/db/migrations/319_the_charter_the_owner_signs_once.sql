-- =============================================================================
-- THE CHARTER THE OWNER SIGNS ONCE
--
-- Every real experiment so far was allowed by the owner pressing a button on
-- its own page, and every act it needed was proposed and approved in that one
-- press, as `founder:<id>`. That is the right shape for a first test and the
-- wrong shape for a studio: a portfolio of dozens of small things cannot ask
-- him once per thing without making him the job.
--
-- A PORTFOLIO ENVELOPE is the owner's standing word, signed once and read by
-- everything that would otherwise ask him: how much a month the studio may
-- put at risk, how many probes may be in flight, how much thinking a day, the
-- rules under which anyone is written to, and the one name the world hears —
-- the Workshop's, never his. It has an end date, so authority he has stopped
-- looking at lapses rather than lingers, and it is renewed from the same page
-- it was signed on.
--
-- WHAT IT DOES NOT DO. It does not touch the ladder. A legal commitment and an
-- irreversible act stay his, one at a time (`consequence_rungs.absorbable`),
-- and nothing here reads that column, on purpose. It does not widen the door:
-- every act still goes through `proposed_acts` with its exact parameters, and
-- what changes is only WHO may say yes to an act inside the envelope — the
-- charter itself, as a principal, and only while it is live.
--
-- WHY THE DECISION GUARD IS REWRITTEN RATHER THAN A SECOND ONE ADDED. SQLite
-- triggers cannot be altered, and two guards on one transition would let a
-- later reader think either was the whole rule. The text below is migration
-- 228's guard with one clause added, and the tests prove both halves: a charter
-- principal is refused the moment the envelope is withdrawn or expired.
-- =============================================================================

CREATE TABLE portfolio_envelopes (
  id                       TEXT PRIMARY KEY,
  founder_id               TEXT NOT NULL REFERENCES founders(id),
  -- What the studio may put at risk in a calendar month, across every probe:
  -- listing fees, small paid tests, sending, the deliverable's own costs.
  monthly_cents            INTEGER NOT NULL CHECK (monthly_cents > 0),
  -- How many probes may be open at once. Small on purpose: a river of nickels
  -- is dug one channel at a time, and twelve is the most a month of thinking
  -- can honestly steward.
  probes_in_flight         INTEGER NOT NULL CHECK (probes_in_flight BETWEEN 1 AND 12),
  -- How much thinking a day the studio may buy across everything it does.
  cognition_cents_per_day  INTEGER NOT NULL CHECK (cognition_cents_per_day > 0),
  -- The rules under which a stranger is written to, in his words. Sealed with
  -- the signature: a probe inside the charter inherits them and cannot loosen
  -- them.
  contact_rules            TEXT NOT NULL,
  -- THE ONE NAME THE WORLD HEARS. Assets speak for themselves; the owner is not
  -- a public figure. This is the Workshop's public name, and every public
  -- surface, sender line and listing carries it and nothing else.
  public_voice             TEXT NOT NULL,
  -- Why he signed, in his words.
  statement                TEXT NOT NULL,
  signed_by                TEXT NOT NULL,
  signed_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at               TEXT NOT NULL,
  withdrawn_at             TEXT,
  withdraw_reason          TEXT
);

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
END;

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
       OR NEW.probes_in_flight IS NOT OLD.probes_in_flight
       OR NEW.cognition_cents_per_day IS NOT OLD.cognition_cents_per_day
       OR NEW.contact_rules IS NOT OLD.contact_rules
       OR NEW.public_voice IS NOT OLD.public_voice
       OR NEW.statement IS NOT OLD.statement
       OR NEW.signed_by IS NOT OLD.signed_by
       OR NEW.signed_at IS NOT OLD.signed_at
       OR NEW.expires_at IS NOT OLD.expires_at;
END;

-- A charter he signed is a fact about him, even after it ends. Append-only
-- means history is not rewritten; it does not mean his data outlives his
-- right to have it removed, so erasure of his account is the one delete.
CREATE TRIGGER portfolio_envelope_no_delete
BEFORE DELETE ON portfolio_envelopes
BEGIN
  SELECT RAISE(ABORT,'portfolio_envelope:immutable') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

CREATE INDEX idx_portfolio_envelopes_live
  ON portfolio_envelopes(founder_id) WHERE withdrawn_at IS NULL;

-- ─── What the envelope has been spent on ─────────────────────────────────────
-- A CARVE is the moment a probe is let inside the charter: so much of this
-- month's money, one of the places in flight. The envelope's remaining balance
-- is arithmetic over these rows, and the arithmetic is enforced here, where a
-- hand that forgot to check it could not get past.
CREATE TABLE portfolio_envelope_carves (
  id             TEXT PRIMARY KEY,
  envelope_id    TEXT NOT NULL REFERENCES portfolio_envelopes(id),
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  cents          INTEGER NOT NULL CHECK (cents >= 0),
  carved_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  -- THE MONTH'S MONEY. This carve plus every carve this calendar month may not
  -- exceed what he signed for the month.
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

CREATE TRIGGER portfolio_envelope_carve_immutable
BEFORE UPDATE ON portfolio_envelope_carves
BEGIN
  SELECT RAISE(ABORT,'portfolio_envelope_carve:immutable');
END;

CREATE TRIGGER portfolio_envelope_carve_no_delete
BEFORE DELETE ON portfolio_envelope_carves
BEGIN
  SELECT RAISE(ABORT,'portfolio_envelope_carve:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE INDEX idx_portfolio_envelope_carves_envelope
  ON portfolio_envelope_carves(envelope_id, carved_at);

-- ─── Who may say yes to an act ────────────────────────────────────────────────
-- Migration 228's guard, with one clause: a live charter of the company's
-- owner may decide an act at that company, as `charter:<envelope id>`. The
-- proposer still cannot approve its own proposal, and nothing else changes.
DROP TRIGGER proposed_act_decision_guard;
CREATE TRIGGER proposed_act_decision_guard
BEFORE UPDATE ON proposed_acts
BEGIN
  -- THE OWNER OF THIS COMPANY, NOT "A FOUNDER" — or the charter he signed,
  -- while it is live. The principal is resolved through the product either
  -- way, so an approval by anyone else is refused by the database rather than
  -- by a route remembering to check.
  SELECT RAISE(ABORT,'proposed_act:not_the_owner')
    WHERE NEW.decision IS NOT NULL AND OLD.decision IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM products p
         WHERE p.id = NEW.product_id AND NEW.decided_by = 'founder:' || p.owner_id)
      AND NOT EXISTS (
        SELECT 1 FROM products p
          JOIN portfolio_envelopes e ON e.founder_id = p.owner_id
         WHERE p.id = NEW.product_id AND NEW.decided_by = 'charter:' || e.id
           AND e.withdrawn_at IS NULL AND datetime(e.expires_at) > datetime('now'));

  -- AND NOT THE THING THAT PROPOSED IT. Belt and braces with the above: an
  -- agent that somehow obtained the owner's principal still cannot use it to
  -- approve its own proposal.
  SELECT RAISE(ABORT,'proposed_act:proposer_cannot_approve')
    WHERE NEW.decision IS NOT NULL AND NEW.decided_by IS NEW.proposed_by;

  SELECT RAISE(ABORT,'proposed_act:already_decided')
    WHERE OLD.decision IS NOT NULL AND NEW.decision IS NOT OLD.decision;

  -- CONSUMED ONCE, EVER, AND ONLY WHAT WAS APPROVED.
  SELECT RAISE(ABORT,'proposed_act:not_consumable') WHERE NEW.consumed_at IS NOT NULL
    AND (OLD.consumed_at IS NOT NULL
      OR OLD.decision IS NOT 'approved'
      OR OLD.revoked_at IS NOT NULL
      OR datetime(OLD.expires_at) <= datetime('now'));

  SELECT RAISE(ABORT,'proposed_act:revoked_after_use')
    WHERE NEW.revoked_at IS NOT NULL AND OLD.consumed_at IS NOT NULL;

  -- What was proposed is what was approved. None of it may drift afterwards.
  SELECT RAISE(ABORT,'proposed_act:immutable')
    WHERE NEW.product_id IS NOT OLD.product_id
       OR NEW.subject IS NOT OLD.subject
       OR NEW.action_type IS NOT OLD.action_type
       OR NEW.params_fingerprint IS NOT OLD.params_fingerprint
       OR NEW.summary IS NOT OLD.summary
       OR NEW.why IS NOT OLD.why
       OR NEW.expected_effect IS NOT OLD.expected_effect
       OR NEW.risk IS NOT OLD.risk
       OR NEW.consequence IS NOT OLD.consequence
       OR NEW.proposed_by IS NOT OLD.proposed_by
       OR NEW.proposed_at IS NOT OLD.proposed_at
       OR NEW.expires_at IS NOT OLD.expires_at;
END;

-- TRIGGERS FIRE NEWEST FIRST, and two guards created after 228 relied on
-- firing before the decision guard: an update to a consumed act's binding was
-- refused as "the binding is sealed", the true reason, rather than by the
-- decision guard's own consumed-act clause. Recreating the decision guard made
-- it the newest, so the two are recreated after it, verbatim, and the order
-- every caller met before this migration is the order they meet after it.
DROP TRIGGER proposed_act_experiment_binding_sealed;
CREATE TRIGGER proposed_act_experiment_binding_sealed
BEFORE UPDATE OF experiment_id, measurement_critical ON proposed_acts
BEGIN
  SELECT RAISE(ABORT,'proposed_act:experiment_binding_is_sealed')
    WHERE OLD.experiment_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM venture_experiments e
                   WHERE e.id = OLD.experiment_id AND e.decision IS NOT NULL)
      AND (NEW.experiment_id IS NOT OLD.experiment_id
        OR NEW.measurement_critical IS NOT OLD.measurement_critical);
  SELECT RAISE(ABORT,'proposed_act:experiment_id_is_immutable')
    WHERE OLD.experiment_id IS NOT NULL AND NEW.experiment_id IS NOT OLD.experiment_id;
  SELECT RAISE(ABORT,'proposed_act:criticality_needs_an_experiment')
    WHERE NEW.measurement_critical IS NOT NULL AND NEW.experiment_id IS NULL;
END;
DROP TRIGGER proposed_acts_undertaking_is_fixed;
CREATE TRIGGER proposed_acts_undertaking_is_fixed
BEFORE UPDATE OF undertaking_id ON proposed_acts
BEGIN SELECT RAISE(ABORT,'proposed_acts:undertaking_is_fixed'); END;
