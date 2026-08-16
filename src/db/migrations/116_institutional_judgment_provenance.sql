-- Reuse the strategic decision log for institutional judgments; add only the
-- provenance it lacked.  A judgment is non-authorizing and non-executing.
ALTER TABLE strategic_decisions_log ADD COLUMN responsibility_refs_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN evidence_refs_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN constraints_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN uncertainties_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN consequences_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN reversible INTEGER;
ALTER TABLE strategic_decisions_log ADD COLUMN expected_economic_effect_json TEXT;
ALTER TABLE strategic_decisions_log ADD COLUMN authority_required_json TEXT;

CREATE TRIGGER institutional_judgment_non_authorizing_guard
BEFORE INSERT ON strategic_decisions_log WHEN NEW.responsibility_refs_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'institutional_judgment:provenance_required') WHERE
    json_valid(NEW.responsibility_refs_json)=0 OR json_array_length(NEW.responsibility_refs_json)<2
    OR json_valid(NEW.evidence_refs_json)=0 OR json_array_length(NEW.evidence_refs_json)=0;
  SELECT RAISE(ABORT,'institutional_judgment:tenant_invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.responsibility_refs_json) refs
    WHERE NOT EXISTS (SELECT 1 FROM institutional_responsibilities r WHERE r.id=refs.value AND r.product_id=NEW.product_id)
  );
END;
