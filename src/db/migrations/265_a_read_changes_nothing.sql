-- A READ CHANGES NOTHING, WHICH IS NOT THE SAME AS BEING EASY TO UNDO.
--
-- The reversibility vocabulary was reversible / recoverable / irreversible, and
-- the lowest of those still describes an act that DID something and could be
-- put back. Asking a public registry when a package was last published does not
-- belong on that scale at all: there is nothing to put back.
--
-- Found by the first real act. Carrying a genuine read-only responsibility
-- through the machinery produced the `reversible` rung, which is one rung too
-- high for looking at a public page — and the consequence is not cosmetic,
-- because the evidence a delegation needs is a function of its ceiling. A
-- read-only responsibility would have required the evidence of one that changes
-- things.
--
-- The distinction is worth having in the vocabulary rather than worked around
-- in a caller, because every future sense will meet it.

DROP TRIGGER act_consequence_floors_constitutional_insert;

INSERT INTO act_consequence_floors (dimension, value, floor_rung, why) VALUES
  ('reversibility','changes_nothing','observe',
   'nothing outside is altered, so there is nothing to undo and nothing anyone '
   || 'could later object to having had done to them');

CREATE TRIGGER act_consequence_floors_constitutional_insert
BEFORE INSERT ON act_consequence_floors
BEGIN SELECT RAISE(ABORT,'act_consequence_floor:constitutional'); END;

-- And the act record has to be able to say it.
CREATE TABLE act_classifications_next (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  product_id     TEXT REFERENCES products(id),
  actor_id       TEXT REFERENCES business_actors(id),
  delegation_id  TEXT REFERENCES delegations(id),
  tool           TEXT NOT NULL,
  capability     TEXT,
  reversibility  TEXT NOT NULL CHECK (reversibility IN
                   ('changes_nothing','reversible','recoverable','irreversible')),
  audience       TEXT NOT NULL CHECK (audience IN
                   ('none','owned_surface','existing_customer','prospect','public','counterparty')),
  external_effect TEXT NOT NULL,
  money_cents    INTEGER NOT NULL DEFAULT 0,
  rung           TEXT NOT NULL REFERENCES consequence_rungs(rung),
  because        TEXT NOT NULL,
  allowed        INTEGER NOT NULL,
  classified_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responsibility TEXT,
  act_class      TEXT
);

INSERT INTO act_classifications_next
  (id, founder_id, product_id, actor_id, delegation_id, tool, capability,
   reversibility, audience, external_effect, money_cents, rung, because, allowed,
   classified_at, responsibility, act_class)
SELECT id, founder_id, product_id, actor_id, delegation_id, tool, capability,
       reversibility, audience, external_effect, money_cents, rung, because, allowed,
       classified_at, responsibility, act_class
  FROM act_classifications;

DROP TABLE act_classifications;
ALTER TABLE act_classifications_next RENAME TO act_classifications;

CREATE INDEX idx_act_classifications ON act_classifications(founder_id, classified_at);
