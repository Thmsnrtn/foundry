-- =============================================================================
-- THINKING NOBODY READ, AND WHERE IT WAS KEPT (Roadmap 2027 R11, 1 October 2026)
--
-- Eight scheduled jobs bought model calls whose output no door, gate or person
-- read: a daily insight, a weekly plan and a spoken morning briefing nobody
-- opened, a signal every two hours, weekly geopolitical and regulatory scans,
-- a knowledge graph and a recovery plan. Six ran on the owner's pre-charter
-- dollar a day. They are retired, and these are the tables only they touched;
-- `check-unreferenced-tables` proves nothing in the code reaches any of them.
--
-- NOTHING IS LOST: as in migrations 368 and 375, every row is copied into
-- retired_rows as JSON, with its product_id, before its table is dropped. No
-- live table holds a key to these, and no trigger or view elsewhere names
-- them (checked against the built schema).
-- =============================================================================

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'causal_chains', product_id, json_object(
  'id', id, 'product_id', product_id, 'chain_description', chain_description,
  'hops', hops, 'root_cause_entity_id', root_cause_entity_id,
  'effect_entity_id', effect_entity_id, 'confidence', confidence,
  'actionable_insight', actionable_insight, 'discovered_at', discovered_at,
  'root_cause_label', root_cause_label, 'effect_label', effect_label)
FROM causal_chains;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'daily_insights', product_id, json_object(
  'id', id, 'product_id', product_id, 'headline', headline, 'context', context,
  'action', action, 'insight_date', insight_date, 'created_at', created_at)
FROM daily_insights;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'geopolitical_signals', product_id, json_object(
  'id', id, 'product_id', product_id, 'owner_id', owner_id,
  'signal_type', signal_type, 'severity', severity, 'description', description,
  'affected_markets', affected_markets, 'source', source,
  'detected_at', detected_at, 'status', status)
FROM geopolitical_signals;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'graph_relationships', product_id, json_object(
  'id', id, 'product_id', product_id, 'source_entity_id', source_entity_id,
  'target_entity_id', target_entity_id, 'relationship_type', relationship_type,
  'weight', weight, 'evidence', evidence, 'created_at', created_at)
FROM graph_relationships;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'regulatory_changes', product_id, json_object(
  'id', id, 'product_id', product_id, 'owner_id', owner_id,
  'change_type', change_type, 'jurisdiction', jurisdiction,
  'description', description, 'impact_level', impact_level,
  'effective_date', effective_date, 'source', source,
  'action_required', action_required, 'status', status,
  'detected_at', detected_at)
FROM regulatory_changes;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'regulatory_profile', product_id, json_object(
  'id', id, 'product_id', product_id, 'owner_id', owner_id,
  'jurisdictions', jurisdictions,
  'regulatory_classifications', regulatory_classifications,
  'compliance_requirements', compliance_requirements,
  'compliance_debt_score', compliance_debt_score, 'updated_at', updated_at)
FROM regulatory_profile;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'weekly_plans', product_id, json_object(
  'id', id, 'product_id', product_id, 'week_of', week_of,
  'signal_at_generation', signal_at_generation, 'items_json', items_json,
  'synthesis', synthesis, 'created_at', created_at)
FROM weekly_plans;

DROP TABLE IF EXISTS causal_chains;
DROP TABLE IF EXISTS daily_insights;
DROP TABLE IF EXISTS geopolitical_signals;
DROP TABLE IF EXISTS graph_relationships;
DROP TABLE IF EXISTS regulatory_changes;
DROP TABLE IF EXISTS regulatory_profile;
DROP TABLE IF EXISTS weekly_plans;

-- And the second ring, found by rerunning the gate: the graph's entities were
-- reachable only as the parent of the relationships dropped above.
INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'graph_entities', product_id, json_object(
  'id', id, 'product_id', product_id, 'entity_type', entity_type,
  'entity_id', entity_id, 'label', label, 'properties', properties,
  'created_at', created_at)
FROM graph_entities;

DROP TABLE IF EXISTS graph_entities;
