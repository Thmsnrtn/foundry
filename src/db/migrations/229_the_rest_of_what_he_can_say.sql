-- =============================================================================
-- THE REST OF WHAT HE CAN SAY
--
-- The owner listed eight kinds of thing an owner statement can be, and was
-- explicit: "Do not force all of these into one persistence model. Determine
-- their proper institutional semantics."
--
-- Four already had a home. Objective and priority are `owner_objectives` —
-- "retention matters more than acquisition" IS an objective, expressed as a
-- comparison. Prohibition and approval-requirement are `owner_boundaries` with
-- the two modes migrations 225 and 228 built. This is the other four, and each
-- gets the shape its meaning actually has:
--
--   BUDGET               a bounded ALLOWANCE. It permits, up to an amount, and
--                        it is spent. Nothing else here is consumable.
--   PREFERENCE           a weighting, consulted when Foundry chooses between
--                        options. NOT enforced, and it says so — which is the
--                        whole reason it is not a boundary.
--   TEMPORARY DIRECTION  an objective that ends on its own. A column, not a
--                        table: it is an objective with a horizon.
--   STOP                 not state at all. An ACT on state that already exists,
--                        so it stores nothing and retires what is live.
--
-- WHY A PREFERENCE IS NOT A WEAK BOUNDARY. "I would rather grow organically
-- than buy ads" is not "do not buy ads". Storing it as a boundary with a softer
-- name would mean Foundry silently refusing something he did not forbid; storing
-- it as an objective would mean it competing with what the company is actually
-- for. It is a tiebreak, it is honest about being one, and the surface says
-- plainly that nothing will be refused because of it.
-- =============================================================================

-- AN OBJECTIVE THAT ENDS ON ITS OWN.
--
-- "Focus on this for the next week" is a real instruction and Foundry quietly
-- ignoring the week would be the institution keeping a direction he had already
-- moved past. NULL means until he says otherwise, which is what an objective
-- without a horizon means.
ALTER TABLE owner_objectives ADD COLUMN until TEXT;

CREATE TABLE owner_allowances (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id),
  -- What it is for, in his words. Not a category: "testing this idea".
  purpose        TEXT NOT NULL,
  statement      TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  set_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  until          TEXT,
  withdrawn_at   TEXT,
  withdraw_reason TEXT
);

CREATE TRIGGER owner_allowance_guard
BEFORE INSERT ON owner_allowances
BEGIN
  SELECT RAISE(ABORT,'owner_allowance:incomplete')
    WHERE trim(NEW.purpose) = '' OR trim(NEW.statement) = '';
  SELECT RAISE(ABORT,'owner_allowance:cannot_arrive_withdrawn')
    WHERE NEW.withdrawn_at IS NOT NULL;
  -- ONE LIVE ALLOWANCE PER COMPANY. Two ceilings is no ceiling: something
  -- would have to decide which applies, and that decision is his.
  SELECT RAISE(ABORT,'owner_allowance:already_one')
    WHERE EXISTS (SELECT 1 FROM owner_allowances a
                   WHERE a.product_id = NEW.product_id AND a.withdrawn_at IS NULL);
END;

CREATE TRIGGER owner_allowance_withdraw_is_one_way
BEFORE UPDATE ON owner_allowances
BEGIN
  SELECT RAISE(ABORT,'owner_allowance:already_withdrawn')
    WHERE OLD.withdrawn_at IS NOT NULL;
  SELECT RAISE(ABORT,'owner_allowance:withdraw_needs_reason')
    WHERE NEW.withdrawn_at IS NOT NULL AND trim(coalesce(NEW.withdraw_reason,'')) = '';
  -- The amount he granted is what he granted. Raising it in place would leave a
  -- record saying a larger ceiling was in force during a period when it was not.
  SELECT RAISE(ABORT,'owner_allowance:immutable')
    WHERE NEW.amount_cents IS NOT OLD.amount_cents
       OR NEW.statement IS NOT OLD.statement
       OR NEW.product_id IS NOT OLD.product_id
       OR NEW.set_at IS NOT OLD.set_at;
END;

CREATE TRIGGER owner_allowance_no_delete
BEFORE DELETE ON owner_allowances
BEGIN
  SELECT RAISE(ABORT,'owner_allowance:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE TABLE owner_preferences (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  statement   TEXT NOT NULL,
  set_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dropped_at  TEXT
);

CREATE TRIGGER owner_preference_guard
BEFORE INSERT ON owner_preferences
BEGIN
  SELECT RAISE(ABORT,'owner_preference:statement_required')
    WHERE trim(NEW.statement) = '';
  SELECT RAISE(ABORT,'owner_preference:cannot_arrive_dropped')
    WHERE NEW.dropped_at IS NOT NULL;
END;

CREATE TRIGGER owner_preference_drop_is_one_way
BEFORE UPDATE ON owner_preferences
BEGIN
  SELECT RAISE(ABORT,'owner_preference:already_dropped')
    WHERE OLD.dropped_at IS NOT NULL;
  SELECT RAISE(ABORT,'owner_preference:immutable')
    WHERE NEW.statement IS NOT OLD.statement OR NEW.product_id IS NOT OLD.product_id;
END;

CREATE TRIGGER owner_preference_no_delete
BEFORE DELETE ON owner_preferences
BEGIN
  SELECT RAISE(ABORT,'owner_preference:immutable') WHERE EXISTS (
    SELECT 1 FROM products p
     WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NULL);
END;

CREATE INDEX idx_owner_allowances_live
  ON owner_allowances(product_id) WHERE withdrawn_at IS NULL;
CREATE INDEX idx_owner_preferences_live
  ON owner_preferences(product_id) WHERE dropped_at IS NULL;
