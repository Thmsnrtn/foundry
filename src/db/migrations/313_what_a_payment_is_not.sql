-- =============================================================================
-- WHAT A PAYMENT IS NOT.
--
-- A `payment` of $29 is recorded. It is not $29 of anything the owner can take
-- out, and until this migration nothing in the institution could say so.
--
--   It is not $29 of cash. Stripe takes a fee at the moment of the charge, and
--   the money sits in a balance for days before a payout moves it to a bank.
--   Gross was being treated as net at the one point where the difference IS
--   the margin.
--
--   It is not $29 of surplus. The thing sold has a variable cost — the fee,
--   the model spend that produced it, whatever it took to deliver — and a tax
--   liability the institution has not set aside.
--
--   It is not even $29 that will stay. Apex Micro's refunds page says, in
--   these words: "No form, no time limit, and you don't have to explain."
--   A delivered piece of work is therefore refundable FOREVER. There is no
--   window to model, and the exposure does not decay. That is a promise the
--   owner made in public and this schema is built to respect it rather than to
--   quietly assume a ninety-day tail nobody was told about.
--
-- ONE LEDGER, APPEND-ONLY, EVERY ROW CARRYING ITS SOURCE.
--
-- Deliberately NOT double-entry. This is a single-owner institution with one
-- Stripe account and no payroll; the rigour that matters is source-event
-- provenance and reconciliation against the provider, not a general accounting
-- engine. If a second account or an entity change ever makes that false, this
-- shape is what changes — and the change will be visible, because every row
-- names where it came from.
--
-- NO MODEL EVER WRITES HERE. Every row is either a provider's own statement of
-- fact or an arithmetic consequence of one, and `claim_quality` says which
-- kind of thing it is. An estimate is allowed exactly once, for the tax
-- reserve, and it carries its own assumptions.
-- =============================================================================

-- ─── The vocabulary of what can happen to money ──────────────────────────────
--
-- Closed, like `business_outcome_event_kinds`, and for the same reason: the
-- projections below read these columns rather than a list kept in TypeScript,
-- so a new kind cannot start meaning something without a migration saying so.
CREATE TABLE IF NOT EXISTS economic_event_kinds (
  kind          TEXT PRIMARY KEY,
  what_it_is    TEXT NOT NULL,
  -- Which way the money moves from the institution's point of view.
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  -- Whether this kind moves money that has actually settled into an account a
  -- human could draw on, as distinct from a Stripe balance or a promise.
  affects_cash  INTEGER NOT NULL DEFAULT 0,
  -- Whether this kind belongs in the variable cost of one unit sold.
  is_unit_cost  INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL
);

INSERT OR IGNORE INTO economic_event_kinds (kind, what_it_is, direction, affects_cash, is_unit_cost, sort_order) VALUES
  ('charge',              'gross money a buyer was charged, as the provider states it',                'in',  0, 0, 1),
  ('provider_fee',        'what the provider took from that charge',                                   'out', 0, 1, 2),
  ('unit_cost',           'what producing or delivering this particular unit cost',                    'out', 0, 1, 3),
  ('refund',              'money returned to a buyer',                                                 'out', 0, 0, 4),
  ('refund_fee_returned', 'a provider fee given back with a refund, where the provider gives it back', 'in',  0, 1, 5),
  ('dispute_withdrawal',  'money the provider withdrew while a buyer disputed a charge',               'out', 0, 0, 6),
  ('dispute_fee',         'what the provider charged for handling a dispute',                          'out', 0, 0, 7),
  ('payout',              'money the provider moved from its balance into a bank account',             'in',  1, 0, 8),
  ('payout_reversed',     'a payout that failed and came back',                                        'out', 1, 0, 9),
  ('operating_spend',     'money the institution spent that is not attributable to one unit',          'out', 1, 0, 10),
  ('owner_contribution',  'money the owner put in',                                                    'in',  1, 0, 11),
  ('owner_distribution',  'money the owner took out',                                                  'out', 1, 0, 12);

-- ─── The assumptions an estimate is allowed to rest on ───────────────────────
--
-- A tax reserve is a guess. It is the only guess in this schema, and it is
-- allowed only because setting aside nothing is a worse guess. What makes it
-- honest is that it cannot exist without saying what it assumed, where the
-- assumption came from, and who set it — and that nothing here ever calls
-- itself a filing, a return, or advice.
CREATE TABLE IF NOT EXISTS economic_policies (
  id            TEXT PRIMARY KEY,
  -- WHOSE ASSUMPTION. A single-owner institution has one set of these, but a
  -- policy with no owner is a policy that would apply to everybody in a
  -- deployment that ever has two — and a tax rate silently inherited from
  -- somebody else is the worst possible kind of shared default.
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  kind          TEXT NOT NULL CHECK (kind IN ('tax_reserve','operating_reserve')),
  -- For a tax reserve: the fraction of the basis to hold back, in basis
  -- points. For an operating reserve: unused.
  rate_bps      INTEGER CHECK (rate_bps IS NULL OR (rate_bps >= 0 AND rate_bps <= 10000)),
  -- For an operating reserve: the floor, in cents. For a tax reserve: unused.
  amount_cents  INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  -- What the rate applies to. Contribution, not gross receipts, unless the
  -- owner says otherwise: tax on money that was never margin is a worse
  -- estimate, not a more careful one.
  basis         TEXT CHECK (basis IS NULL OR basis IN ('contribution','gross_receipts')),
  -- WHERE THE NUMBER CAME FROM. Not a citation the institution invented — the
  -- owner's own statement of what he is assuming and why. An estimate whose
  -- provenance is blank is a number nobody can check, which is the failure
  -- this column exists to prevent.
  source        TEXT NOT NULL CHECK (trim(source) <> ''),
  because       TEXT NOT NULL CHECK (trim(because) <> ''),
  set_by        TEXT NOT NULL,
  set_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  superseded_by TEXT REFERENCES economic_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_economic_policies_live ON economic_policies(founder_id, kind, superseded_at);

-- ─── The ledger ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS economic_events (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  kind            TEXT NOT NULL REFERENCES economic_event_kinds(kind),
  -- ALWAYS A MAGNITUDE. Direction lives in the kind, so a sign here could only
  -- ever contradict it. A zero-amount row is a statement that something
  -- happened and cost nothing, which is a different fact from no row at all.
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency        TEXT NOT NULL DEFAULT 'usd',
  -- The source's clock, not ours.
  occurred_at     TEXT NOT NULL,
  provider        TEXT NOT NULL,
  -- The provider's own id for the thing this row describes. With `kind` and
  -- `provider` this is what makes intake idempotent and what a reconciler
  -- would ask the other side about.
  provider_ref    TEXT NOT NULL,
  -- The outcome event this came from, when it came from one. A `charge` row
  -- always has one; a `payout` never does, because a payout is about the
  -- balance rather than about any single sale.
  source_event_id TEXT REFERENCES business_outcome_events(id),
  -- The fulfilment this is attributable to, for the kinds that belong to one
  -- unit. `is_unit_cost` says which kinds those are; the guard below enforces
  -- that a unit cost names its unit.
  fulfilment_id   TEXT REFERENCES experiment_fulfilments(id),
  -- MEASURED is a provider's own statement or arithmetic over one. ESTIMATED
  -- is a number the institution worked out from an assumption it is holding,
  -- and every estimated row must name the policy it came from.
  claim_quality   TEXT NOT NULL CHECK (claim_quality IN ('measured','estimated')),
  policy_id       TEXT REFERENCES economic_policies(id),
  -- Real money, a provider's test mode, or a row that exists to illustrate.
  -- The projections refuse to mix them, so a sandbox charge can never turn
  -- into surplus the owner is told he may take.
  evidence_mode   TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  -- Why this row exists, in words, for the person reading the ledger later.
  because         TEXT NOT NULL CHECK (trim(because) <> ''),
  recorded_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_ref, kind)
);

CREATE INDEX IF NOT EXISTS idx_economic_events_founder ON economic_events(founder_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_economic_events_kind ON economic_events(kind, occurred_at);
CREATE INDEX IF NOT EXISTS idx_economic_events_fulfilment ON economic_events(fulfilment_id);

-- ─── The ledger does not change its mind ─────────────────────────────────────
--
-- Append-only in the schema rather than by convention. A correction is a new
-- row that says what it corrects, which is how a provider's own ledger works
-- and how a reader six months from now can tell a mistake from a revision.
CREATE TRIGGER IF NOT EXISTS economic_events_append_only_update
BEFORE UPDATE ON economic_events
BEGIN
  SELECT RAISE(ABORT,'economic_event:append_only');
END;

CREATE TRIGGER IF NOT EXISTS economic_events_append_only_delete
BEFORE DELETE ON economic_events
BEGIN
  SELECT RAISE(ABORT,'economic_event:append_only');
END;

-- ─── What a row must be able to answer for itself ────────────────────────────
CREATE TRIGGER IF NOT EXISTS economic_event_guard
BEFORE INSERT ON economic_events
BEGIN
  -- An estimate with no assumption behind it is a number nobody can check.
  SELECT RAISE(ABORT,'economic_event:estimate_needs_policy')
    WHERE NEW.claim_quality = 'estimated' AND NEW.policy_id IS NULL;
  -- And a measured figure must NOT name a policy: the moment an assumption
  -- touches it, it is an estimate, and the column that says so must say so.
  SELECT RAISE(ABORT,'economic_event:measured_cannot_assume')
    WHERE NEW.claim_quality = 'measured' AND NEW.policy_id IS NOT NULL;
  -- A cost that belongs to one unit has to name the unit, or it cannot be
  -- subtracted from that unit's revenue and will silently vanish from
  -- contribution.
  SELECT RAISE(ABORT,'economic_event:unit_cost_needs_unit')
    WHERE NEW.fulfilment_id IS NULL AND EXISTS (
      SELECT 1 FROM economic_event_kinds k WHERE k.kind = NEW.kind AND k.is_unit_cost = 1);
  -- A charge is the one kind that must point back at the outcome event that
  -- recorded it, so gross can never be asserted without the provider's own
  -- statement standing behind it.
  SELECT RAISE(ABORT,'economic_event:charge_needs_source')
    WHERE NEW.kind = 'charge' AND NEW.source_event_id IS NULL;
  -- The evidence mode of a derived row must match the event it derives from.
  -- Without this a real fee could be attached to a sandbox charge, and the
  -- projections' refusal to mix worlds would be defeated one row at a time.
  SELECT RAISE(ABORT,'economic_event:evidence_mode_mismatch')
    WHERE NEW.source_event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM business_outcome_events e
       WHERE e.id = NEW.source_event_id AND e.evidence_mode <> NEW.evidence_mode);
END;
