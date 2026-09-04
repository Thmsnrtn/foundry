-- NEVER SEVER THE CHAIN AT THE CANDIDATE.
--
-- Discovery builds a provenance chain with enormous care: an asset comes from a
-- candidate, which came from a seed, which came from an interpretation, which
-- cites the verbatim span of something a person actually wrote. `products` has
-- been altered twenty times across migrations 008-242 and never given a way to
-- point back. So the chain terminates at `venture_opportunities` and dies
-- there, and the moment a candidate becomes something he owns, the reason
-- anybody was ever curious about it is unreachable.
--
-- This is cheap now and impossible later. A link that is not written at birth
-- cannot be reconstructed once the asset is running.

ALTER TABLE products ADD COLUMN from_opportunity_id TEXT REFERENCES venture_opportunities(id);

-- A LINEAGE THAT CAN BE REWRITTEN IS NOT A LINEAGE.
--
-- Write-once. It may be set on a product that has none (an asset acquired
-- before this existed, attributed later by hand), and never changed after.
CREATE TRIGGER product_lineage_is_write_once
BEFORE UPDATE OF from_opportunity_id ON products
WHEN OLD.from_opportunity_id IS NOT NULL
     AND NEW.from_opportunity_id IS NOT OLD.from_opportunity_id
BEGIN SELECT RAISE(ABORT,'product_lineage:write_once'); END;

-- A REHEARSAL MAY NOT FATHER A REAL COMPANY.
--
-- The same boundary the evidence tables carry. A candidate discovered in the
-- reference world is a rehearsal of discovery; an asset descended from it would
-- be a real company whose origin story is a simulation, which is the exact
-- confusion the reality boundary exists to prevent.
CREATE TRIGGER product_lineage_evidence_mode_insert
BEFORE INSERT ON products
WHEN NEW.from_opportunity_id IS NOT NULL
     AND NEW.reality = 'real'
     AND (SELECT evidence_mode FROM venture_opportunities
           WHERE id = NEW.from_opportunity_id) <> 'real'
BEGIN SELECT RAISE(ABORT,'product_lineage:evidence_mode_mismatch'); END;

CREATE TRIGGER product_lineage_evidence_mode_update
BEFORE UPDATE OF from_opportunity_id ON products
WHEN NEW.from_opportunity_id IS NOT NULL
     AND NEW.reality = 'real'
     AND (SELECT evidence_mode FROM venture_opportunities
           WHERE id = NEW.from_opportunity_id) <> 'real'
BEGIN SELECT RAISE(ABORT,'product_lineage:evidence_mode_mismatch'); END;

CREATE INDEX idx_products_from_opportunity ON products(from_opportunity_id)
  WHERE from_opportunity_id IS NOT NULL;
