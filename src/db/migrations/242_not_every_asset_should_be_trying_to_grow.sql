-- =============================================================================
-- NOT EVERY ASSET SHOULD ALWAYS BE TRYING TO GROW
--
-- `company_lifecycle_state` knows five states and every one of them is a rung
-- on a ladder that only goes up: setup, learning, operating, optimizing,
-- scaling. That is the shape of a venture-backed startup, and it is the wrong
-- shape for a river of nickels. A $400-a-month asset with stable customers, an
-- $18 bill and nobody's attention is not a business that failed to scale. It
-- is a tributary, and the right thing to do with it may be nothing for years.
--
-- POSTURE IS WHAT THE OWNER IS TRYING TO DO WITH A THING, and it is his to
-- set: grow it, hold it, harvest it, reposition it, sell it, retire it. Foundry
-- may recommend a posture. It may not choose one, because two of them are the
-- irreversible acts the constitution reserves to him and the others change
-- where his money and attention go.
--
-- AND FORM IS WHAT KIND OF THING IT IS, in his words. Free text, deliberately:
-- "a paid dataset", "a calculator people pay per use", "subscription software".
-- A closed list of forms would become the list of things the institution is
-- able to own, which is the exact failure the venture mandate names.
-- =============================================================================

ALTER TABLE products ADD COLUMN posture TEXT NOT NULL DEFAULT 'grow'
  CHECK (posture IN ('grow','hold','harvest','reposition','sell','retire'));
ALTER TABLE products ADD COLUMN form TEXT;

-- The record of every change of posture, because "why is this in harvest" is a
-- question that will be asked a year later by someone who was not there.
CREATE TABLE posture_changes (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  founder_id  TEXT NOT NULL REFERENCES founders(id),
  from_posture TEXT NOT NULL,
  to_posture  TEXT NOT NULL,
  -- His sentence, kept whole.
  said        TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER posture_change_guard
BEFORE INSERT ON posture_changes
BEGIN
  SELECT RAISE(ABORT,'posture_change:incomplete')
    WHERE trim(NEW.said) = '' OR trim(NEW.changed_by) = '';
  SELECT RAISE(ABORT,'posture_change:no_change')
    WHERE NEW.from_posture = NEW.to_posture;
  -- ONLY THE OWNER SETS A POSTURE. Foundry recommends; it does not decide where
  -- his money and attention go, and it never decides to sell or retire.
  SELECT RAISE(ABORT,'posture_change:owner_only')
    WHERE NEW.changed_by NOT LIKE 'founder:%';
END;

CREATE TRIGGER posture_change_immutable
BEFORE UPDATE ON posture_changes
BEGIN SELECT RAISE(ABORT,'posture_change:immutable'); END;

CREATE INDEX idx_posture_changes_product ON posture_changes(product_id, changed_at);
