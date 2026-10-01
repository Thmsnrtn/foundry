-- =============================================================================
-- WHAT THE SCHEDULER WROTE FOR NOBODY (Roadmap 2027 R12, 1 October 2026)
--
-- Twenty scheduled jobs wrote rows nothing read, or could never find work in
-- this deployment. They are retired; these are the tables only they touched,
-- with the lifecycle-condition reader that nothing called. As in migrations
-- 368, 375 and 376, every row is copied into retired_rows as JSON before its
-- table is dropped, with its product_id where it has one (portfolio snapshots
-- are an organisation's aggregates and name no company). No live table holds
-- a key to these, and no trigger or view elsewhere names them.
-- =============================================================================

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'lifecycle_conditions', product_id, json_object(
  'product_id', product_id, 'prompt', prompt, 'condition_name', condition_name,
  'condition_met', condition_met, 'current_value', current_value,
  'threshold_value', threshold_value, 'last_checked', last_checked)
FROM lifecycle_conditions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'portfolio_snapshots', NULL, json_object(
  'id', id, 'portfolio_id', portfolio_id, 'snapshot_date', snapshot_date,
  'total_companies', total_companies, 'avg_mrr', avg_mrr,
  'median_mrr', median_mrr, 'companies_green', companies_green,
  'companies_yellow', companies_yellow, 'companies_red', companies_red,
  'avg_growth_rate', avg_growth_rate,
  'total_portfolio_mrr', total_portfolio_mrr, 'highlights', highlights,
  'concerns', concerns, 'created_at', created_at)
FROM portfolio_snapshots;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'prediction_accuracy', product_id, json_object(
  'id', id, 'product_id', product_id, 'scenario_model_id', scenario_model_id,
  'decision_id', decision_id, 'option_chosen', option_chosen,
  'predicted_mrr_delta_pct', predicted_mrr_delta_pct,
  'predicted_outcome_direction', predicted_outcome_direction,
  'predicted_timeframe_days', predicted_timeframe_days,
  'actual_mrr_delta_pct', actual_mrr_delta_pct,
  'actual_outcome_direction', actual_outcome_direction,
  'actual_timeframe_days', actual_timeframe_days,
  'direction_correct', direction_correct,
  'magnitude_accuracy', magnitude_accuracy,
  'timeframe_accuracy', timeframe_accuracy,
  'composite_accuracy', composite_accuracy, 'measured_at', measured_at,
  'created_at', created_at)
FROM prediction_accuracy;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'predictions', product_id, json_object(
  'id', id, 'product_id', product_id, 'owner_id', owner_id,
  'prediction_type', prediction_type, 'description', description,
  'probability', probability, 'time_horizon_days', time_horizon_days,
  'evidence', evidence, 'recommended_action', recommended_action,
  'pattern_sources', pattern_sources, 'status', status, 'outcome', outcome,
  'outcome_recorded_at', outcome_recorded_at, 'accuracy_score', accuracy_score,
  'created_at', created_at)
FROM predictions;

DROP TABLE IF EXISTS lifecycle_conditions;
DROP TABLE IF EXISTS portfolio_snapshots;
DROP TABLE IF EXISTS prediction_accuracy;
DROP TABLE IF EXISTS predictions;
