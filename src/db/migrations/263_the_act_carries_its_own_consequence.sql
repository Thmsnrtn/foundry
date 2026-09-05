-- THE ACT CARRIES ITS OWN CONSEQUENCE, AND THE COMPANY CARRIES ITS OWN NAME.
--
-- Two things this institution could not express, and both block real hands.
--
-- ONE. Consequence was attached to the CAPABILITY. So `act_in_a_browser` sat at
-- one rung whether it was reading a page or accepting somebody's terms, and a
-- browser click, an API call and a shell command producing the identical effect
-- fell under three different rules — or the same wrong one. Consequence belongs
-- to what the act DOES: who it reaches, whether it can be undone, what it
-- costs, how much of it there is.
--
-- TWO. The institution knew who AUTHORISED an act (`acting-principal`) and had
-- no way to say whose identity it WEARS. Those are different facts. The owner
-- authorises; the company acts. An institution whose every asset speaks as its
-- owner is one whose assets cannot be sold — the buyer cannot take the support
-- inbox, the marketplace account or the sending domain with them, because all
-- of it was him.

-- ─── WHO IS ACTING, AS DISTINCT FROM WHO ALLOWED IT ────────────────────────
CREATE TABLE business_actors (
  id           TEXT PRIMARY KEY,
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  -- NULL means the institution itself. Foundry is a real company and acts as
  -- one; it is not a stand-in for the owner.
  product_id   TEXT REFERENCES products(id),
  kind         TEXT NOT NULL CHECK (kind IN
                 ('company','asset','brand','support_channel','marketplace_account','owner')),
  -- What a recipient actually sees.
  display_name TEXT NOT NULL,
  -- How the world reaches it: a domain, an address, an account handle.
  external_ref TEXT,
  -- WOULD THIS IDENTITY GO WITH THE ASSET IF IT WERE SOLD?
  --
  -- Recorded at birth because it cannot be reconstructed later, and because an
  -- asset whose channels are all personal is a job rather than a holding.
  portable     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at   TEXT
);

CREATE INDEX idx_business_actors_product ON business_actors(product_id, retired_at);

-- THE OWNER'S OWN IDENTITY IS NEVER PORTABLE. It does not transfer with a sale,
-- and an asset that depended on it was never separable in the first place.
CREATE TRIGGER business_actor_owner_is_not_portable
BEFORE INSERT ON business_actors
WHEN NEW.kind = 'owner' AND NEW.portable = 1
BEGIN SELECT RAISE(ABORT,'business_actor:owner_is_not_portable'); END;

-- An identity belonging to a company must say which one.
CREATE TRIGGER business_actor_asset_names_its_company
BEFORE INSERT ON business_actors
WHEN NEW.kind IN ('asset','support_channel','marketplace_account') AND NEW.product_id IS NULL
BEGIN SELECT RAISE(ABORT,'business_actor:needs_a_company'); END;

-- ─── WHAT AN ACT'S ATTRIBUTES IMPLY ────────────────────────────────────────
--
-- Constitutional floors. The rung an act stands on is the HIGHEST floor any of
-- its attributes implies, and never lower than its capability's own rung. These
-- are claims about consequence in the world, not settings.
CREATE TABLE act_consequence_floors (
  dimension   TEXT NOT NULL,
  value       TEXT NOT NULL,
  floor_rung  TEXT NOT NULL REFERENCES consequence_rungs(rung),
  why         TEXT NOT NULL,
  PRIMARY KEY (dimension, value)
);

INSERT INTO act_consequence_floors (dimension, value, floor_rung, why) VALUES
  ('reversibility','reversible','reversible',
   'it can be put back, so the cost of being wrong is the effort of undoing it'),
  ('reversibility','recoverable','public',
   'it can be recovered from, but somebody outside may have seen it first'),
  ('reversibility','irreversible','destructive',
   'it cannot be undone, and an act that cannot be undone is never absorbed into ordinary authority'),
  ('audience','none','observe',
   'nothing outside can tell it happened'),
  ('audience','owned_surface','public',
   'it changes something the world can see, on a surface we control'),
  ('audience','existing_customer','public',
   'somebody who already chose to hear from us is reached'),
  ('audience','prospect','public',
   'somebody who did not ask to hear from us is reached, which is where reputation is spent'),
  ('audience','public','public',
   'anybody may see it, and it cannot be recalled from those who did'),
  ('audience','counterparty','legal',
   'the other side of an agreement is engaged, and what is said may bind us');

CREATE TRIGGER act_consequence_floors_constitutional_insert
BEFORE INSERT ON act_consequence_floors
BEGIN SELECT RAISE(ABORT,'act_consequence_floor:constitutional'); END;
CREATE TRIGGER act_consequence_floors_constitutional_update
BEFORE UPDATE ON act_consequence_floors
BEGIN SELECT RAISE(ABORT,'act_consequence_floor:constitutional'); END;
CREATE TRIGGER act_consequence_floors_constitutional_delete
BEFORE DELETE ON act_consequence_floors
BEGIN SELECT RAISE(ABORT,'act_consequence_floor:constitutional'); END;

-- ─── BOUNDED STANDING AUTHORITY ────────────────────────────────────────────
--
-- The thing that lets an institution carry responsibility instead of asking
-- about every ordinary act. A delegation names a CLASS of action, the identity
-- it is performed as, who may be reached, what it may never do, and the limits
-- it dies at.
--
-- The class is free text on purpose. Freezing a vocabulary of delegation kinds
-- here would be inventing responsibilities before any exist; classes should be
-- derived from what the portfolio actually needs.
CREATE TABLE delegations (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  product_id     TEXT REFERENCES products(id),
  actor_id       TEXT NOT NULL REFERENCES business_actors(id),
  class          TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  -- CHECKED RATHER THAN REFERENCED: `act_consequence_floors` is keyed on
  -- (dimension, value), so a foreign key to `value` alone is a mismatch. The
  -- vocabulary is the same one, and the floors table remains where the meaning
  -- of each value lives.
  audience       TEXT NOT NULL CHECK (audience IN
                   ('none','owned_surface','existing_customer','prospect','public','counterparty')),
  -- WHAT IT MAY NEVER DO UNDER THIS DELEGATION. Required. A permission with no
  -- stated exclusions has not been thought about, and the exclusions are the
  -- half the owner actually reads.
  excludes       TEXT NOT NULL,
  -- The highest rung acts under this delegation may stand on.
  ceiling        TEXT NOT NULL REFERENCES consequence_rungs(rung),
  max_acts_per_day  INTEGER,
  max_cents_per_day INTEGER,
  -- NO PERMANENT DELEGATIONS. Standing authority that never lapses is authority
  -- nobody revisits.
  expires_at     TEXT NOT NULL,
  granted_by     TEXT NOT NULL,
  granted_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- What made this eligible: a calibration record, a controlled proof. Nullable
  -- because the owner may grant on his own judgment and owes nobody a citation.
  evidence_ref   TEXT,
  revoked_at     TEXT,
  revoked_reason TEXT
);

CREATE INDEX idx_delegations_live ON delegations(founder_id, product_id, revoked_at);

-- A DELEGATION MAY NEVER COVER WHAT MAY NEVER BE ABSORBED.
--
-- This is the constitutional guarantee that makes standing authority safe to
-- grant at all: the rungs marked non-absorbable stay the owner's, one act at a
-- time, and no policy — however well-evidenced, however well-behaved the
-- institution has been — can reach them.
CREATE TRIGGER delegation_may_not_absorb_the_unabsorbable
BEFORE INSERT ON delegations
BEGIN
  SELECT RAISE(ABORT,'delegation:ceiling_is_not_absorbable')
    WHERE (SELECT absorbable FROM consequence_rungs WHERE rung = NEW.ceiling) = 0;
  SELECT RAISE(ABORT,'delegation:needs_exclusions')
    WHERE trim(NEW.excludes) = '';
  SELECT RAISE(ABORT,'delegation:must_expire')
    WHERE datetime(NEW.expires_at) <= datetime(NEW.granted_at);
  -- Only a person grants standing authority.
  SELECT RAISE(ABORT,'delegation:not_granted_by_a_person')
    WHERE NEW.granted_by NOT LIKE 'founder:%';
END;

-- ─── CIRCUIT BREAKERS, DRIVEN BY THE WORLD ─────────────────────────────────
--
-- Counted facts the world produced, never the model's opinion that it should
-- stop. The model may recommend stopping; a hard boundary needs enforcement
-- that does not depend on the thing being bounded.
CREATE TABLE delegation_breakers (
  id             TEXT PRIMARY KEY,
  delegation_id  TEXT NOT NULL REFERENCES delegations(id),
  counted_fact   TEXT NOT NULL CHECK (counted_fact IN
                   ('complaint','bounce','provider_rejection','provider_error',
                    'refund','dispute','negative_reply','unexpected_cost',
                    'legal_language','security_anomaly','volume_deviation')),
  window_minutes INTEGER NOT NULL,
  threshold      INTEGER NOT NULL,
  tripped_at     TEXT,
  tripped_by     TEXT,
  cleared_at     TEXT,
  cleared_by     TEXT
);

CREATE INDEX idx_delegation_breakers ON delegation_breakers(delegation_id, tripped_at);

-- A BREAKER THAT RESETS ITSELF IS A BREAKER THAT TRIPS SIX TIMES A NIGHT AND
-- TEACHES HIM TO IGNORE IT. Only a person clears one.
CREATE TRIGGER delegation_breaker_cleared_by_a_person
BEFORE UPDATE OF cleared_at ON delegation_breakers
WHEN NEW.cleared_at IS NOT NULL AND (NEW.cleared_by IS NULL OR NEW.cleared_by NOT LIKE 'founder:%')
BEGIN SELECT RAISE(ABORT,'delegation_breaker:cleared_only_by_a_person'); END;

-- ─── WHAT A PARTICULAR ACT WAS JUDGED TO BE ────────────────────────────────
CREATE TABLE act_classifications (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  product_id     TEXT REFERENCES products(id),
  actor_id       TEXT REFERENCES business_actors(id),
  delegation_id  TEXT REFERENCES delegations(id),
  tool           TEXT NOT NULL,
  capability     TEXT,
  reversibility  TEXT NOT NULL CHECK (reversibility IN
                   ('reversible','recoverable','irreversible')),
  audience       TEXT NOT NULL CHECK (audience IN
                   ('none','owned_surface','existing_customer','prospect','public','counterparty')),
  external_effect TEXT NOT NULL,
  money_cents    INTEGER NOT NULL DEFAULT 0,
  rung           TEXT NOT NULL REFERENCES consequence_rungs(rung),
  because        TEXT NOT NULL,
  allowed        INTEGER NOT NULL,
  classified_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_act_classifications ON act_classifications(founder_id, classified_at);
