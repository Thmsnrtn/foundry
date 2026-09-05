-- A RESPONSIBILITY IS NOT A SHAPE OF ACT, AND A BAR IS NOT A TRUTH.
--
-- Four corrections to the delegation machinery, made before the first real act
-- turns any of them into precedent.
--
-- ONE. THE EVIDENCE BAR WAS HARDCODED IN TYPESCRIPT AS IF IT WERE CONSTITUTIONAL.
-- "Three graded observations, forty graded spending acts" are useful present
-- policy and nothing more. The durable principle is that the evidence required
-- before RECOMMENDING a broader delegation scales with the responsibility and
-- its downside — and two acts on the same rung can need radically different
-- evidence depending on failure cost, blast radius, variance and novelty. So
-- the numbers move into a table the owner can change, and the principle stays
-- in the comment where the numbers used to be.
--
-- TWO. PROPOSING A DELEGATION REQUIRED HAVING INTERRUPTED HIM THREE TIMES.
-- That made owner attention the price of learning that work recurs, and owner
-- attention is the thing this institution exists to conserve. Repeated
-- refusals are ONE signal of recurrence. A queue that keeps filling, a
-- schedule that keeps firing, work Foundry repeatedly prepares and cannot
-- finish, and the owner saying a class should eventually be handled are all
-- legitimate evidence — and none of them costs him anything.
--
-- THREE. "NO DELEGATION MAY BE PERMANENT" MEANT MANDATORY EXPIRY AND MANUAL
-- REAPPROVAL FOREVER. At one asset that is prudence; at nine it is a calendar
-- of re-permissioning, which is the organisational burden this institution
-- exists to absorb. The invariant that actually matters is that no delegation
-- is IRREVOCABLE, UNBOUNDED or IMMUNE TO REASSESSMENT — so a delegation must
-- carry either an expiry or a review cadence, never neither, and Foundry
-- carries the review, involving him only when something materially changed.
--
-- FOUR. GROUPING BY COMPANY + AUDIENCE + RUNG DOES NOT IDENTIFY A
-- RESPONSIBILITY. A support reply to a customer and promotional outreach to
-- that same customer share the company, the audience and the consequence, and
-- must never share a permission. What is being absorbed is a RESPONSIBILITY;
-- the permission exists so Foundry can carry it.

-- ─── EVIDENCE IS POLICY ────────────────────────────────────────────────────
CREATE TABLE delegation_evidence_policy (
  id                TEXT PRIMARY KEY,
  founder_id        TEXT NOT NULL REFERENCES founders(id),
  -- What this bar applies to. A rung is the coarsest useful key and the one
  -- available today; a responsibility class may be named instead as classes
  -- earn their own bars.
  ceiling           TEXT NOT NULL REFERENCES consequence_rungs(rung),
  responsibility    TEXT,
  -- How many graded predictions before Foundry may RECOMMEND delegating.
  min_graded        INTEGER NOT NULL,
  -- Of those, how many must have been settled by what actually happened rather
  -- than by the owner agreeing in hindsight. A record he graded himself is a
  -- record of agreement.
  min_from_world    INTEGER NOT NULL,
  -- Above this proportion of surprises, no recommendation regardless of count.
  max_surprise_bp   INTEGER NOT NULL,
  why               TEXT NOT NULL,
  set_by            TEXT NOT NULL,
  set_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at     TEXT
);

CREATE INDEX idx_evidence_policy_live
  ON delegation_evidence_policy(founder_id, ceiling, superseded_at);

-- ─── EVIDENCE THAT A RESPONSIBILITY RECURS ─────────────────────────────────
--
-- Deliberately several kinds. An institution that could only learn work recurs
-- by interrupting its owner would have to interrupt him to stop interrupting
-- him.
CREATE TABLE responsibility_signals (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  product_id     TEXT REFERENCES products(id),
  -- What the work IS, in the institution's own words. The identity of the
  -- responsibility, not the shape of one act inside it.
  responsibility TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN
                   ('refused_for_authority','recurring_queue','scheduled',
                    'prepared_not_finished','owner_intent')),
  -- What actually happened, so the signal can be checked rather than believed.
  ref            TEXT NOT NULL,
  noted_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_responsibility_signals
  ON responsibility_signals(founder_id, responsibility, noted_at);

-- ─── DELEGATIONS, REBUILT ──────────────────────────────────────────────────
--
-- Rebuilt rather than altered: `expires_at` has to become optional, and the
-- table now carries the responsibility it exists to serve. Empty everywhere, so
-- the copy below is a formality that would still be correct if it were not.
CREATE TABLE delegations_next (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  product_id     TEXT REFERENCES products(id),
  actor_id       TEXT NOT NULL REFERENCES business_actors(id),
  -- WHAT RESPONSIBILITY THIS EXISTS TO CARRY. Not a shape of act.
  responsibility TEXT NOT NULL,
  -- The kind of act within it: 'answer a question', 'update a listing'. Two act
  -- classes inside one responsibility are two delegations, on purpose.
  act_class      TEXT NOT NULL,
  class          TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  audience       TEXT NOT NULL CHECK (audience IN
                   ('none','owned_surface','existing_customer','prospect','public','counterparty')),
  -- What content or data this may touch. A support reply and a promotional
  -- message can share a company, an audience and a rung; they do not share this.
  content_scope  TEXT NOT NULL,
  excludes       TEXT NOT NULL,
  ceiling        TEXT NOT NULL REFERENCES consequence_rungs(rung),
  max_acts_per_day  INTEGER,
  max_cents_per_day INTEGER,
  -- EITHER AN EXPIRY OR A CADENCE, NEVER NEITHER. Durable standing authority is
  -- allowed; unreassessable authority is not.
  expires_at     TEXT,
  review_every_days INTEGER,
  last_reviewed_at  TEXT,
  granted_by     TEXT NOT NULL,
  granted_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_ref   TEXT,
  revoked_at     TEXT,
  revoked_reason TEXT
);

INSERT INTO delegations_next
  (id, founder_id, product_id, actor_id, responsibility, act_class, class, purpose,
   audience, content_scope, excludes, ceiling, max_acts_per_day, max_cents_per_day,
   expires_at, granted_by, granted_at, evidence_ref, revoked_at, revoked_reason)
SELECT id, founder_id, product_id, actor_id, class, class, class, purpose,
       audience, 'not stated when this was granted', excludes, ceiling,
       max_acts_per_day, max_cents_per_day, expires_at, granted_by, granted_at,
       evidence_ref, revoked_at, revoked_reason
  FROM delegations;

DROP TRIGGER delegation_may_not_absorb_the_unabsorbable;
DROP TABLE delegations;
ALTER TABLE delegations_next RENAME TO delegations;

CREATE INDEX idx_delegations_live ON delegations(founder_id, product_id, revoked_at);

CREATE TRIGGER delegation_may_not_absorb_the_unabsorbable
BEFORE INSERT ON delegations
BEGIN
  SELECT RAISE(ABORT,'delegation:ceiling_is_not_absorbable')
    WHERE (SELECT absorbable FROM consequence_rungs WHERE rung = NEW.ceiling) = 0;
  SELECT RAISE(ABORT,'delegation:needs_exclusions')
    WHERE trim(NEW.excludes) = '';
  SELECT RAISE(ABORT,'delegation:needs_a_responsibility')
    WHERE trim(NEW.responsibility) = '' OR trim(NEW.act_class) = '';
  -- NO DELEGATION IS IMMUNE TO REASSESSMENT. It may be durable — remaining
  -- until revoked while its boundaries hold and nothing trips — and it may not
  -- be unreviewable.
  SELECT RAISE(ABORT,'delegation:must_be_reassessable')
    WHERE (NEW.expires_at IS NULL AND NEW.review_every_days IS NULL)
       OR (NEW.expires_at IS NOT NULL
           AND datetime(NEW.expires_at) <= datetime(NEW.granted_at))
       OR (NEW.review_every_days IS NOT NULL AND NEW.review_every_days <= 0);
  SELECT RAISE(ABORT,'delegation:not_granted_by_a_person')
    WHERE NEW.granted_by NOT LIKE 'founder:%';
END;

-- ─── AND THE ACT RECORD LEARNS WHAT IT WAS FOR ─────────────────────────────
ALTER TABLE act_classifications ADD COLUMN responsibility TEXT;
ALTER TABLE act_classifications ADD COLUMN act_class TEXT;

-- ─── A CONSERVATIVE STARTING POLICY, WHICH IS ALL IT IS ────────────────────
--
-- Seeded so the machinery has a bar to read, and seeded as POLICY: every number
-- here is a present judgment the owner may supersede with a row of his own. The
-- shape is the durable part — more evidence for more consequence, and a
-- proportion of it settled by what actually happened rather than by his
-- agreement in hindsight.
--
-- `legal` and `destructive` are absent on purpose rather than set high. No bar
-- exists for them because no amount of evidence makes them delegable, and a
-- large number would imply one eventually would.
INSERT INTO delegation_evidence_policy
  (id, founder_id, ceiling, min_graded, min_from_world, max_surprise_bp, why, set_by)
SELECT 'evp_' || f.id || '_' || r.rung, f.id, r.rung,
       CASE r.rung WHEN 'observe' THEN 3 WHEN 'prepare' THEN 3
                   WHEN 'reversible' THEN 8 WHEN 'public' THEN 20
                   ELSE 40 END,
       CASE r.rung WHEN 'observe' THEN 1 WHEN 'prepare' THEN 1
                   WHEN 'reversible' THEN 4 WHEN 'public' THEN 12
                   ELSE 30 END,
       CASE r.rung WHEN 'observe' THEN 3300 WHEN 'prepare' THEN 3300
                   WHEN 'reversible' THEN 2500 WHEN 'public' THEN 1500
                   ELSE 1000 END,
       'conservative starting policy, not a truth about the world: more evidence '
       || 'for more consequence, and most of it settled by what happened rather '
       || 'than by agreeing in hindsight',
       'institution:starting_policy'
  FROM founders f
  CROSS JOIN consequence_rungs r
 WHERE r.absorbable = 1;
