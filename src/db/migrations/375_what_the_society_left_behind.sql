-- =============================================================================
-- WHAT THE SOCIETY LEFT BEHIND (Roadmap 2027 R4 and R9, 1 October 2026)
--
-- The owner retired the twelve named agents on 30 September 2026 (PENDING 16:
-- "Retire them"). Their schedules had already stopped; this release deletes
-- their code, the twenty-six loops that ran them, the modules only those loops
-- reached, the public API that served their briefings, and two weekly jobs that
-- measured them (team health, outcome trees). What was left is these tables:
-- nothing in the code can read or write any of them, which
-- `check-unreferenced-tables` proves rather than asserts.
--
-- NOTHING IS LOST. As in migration 368, every row is copied into retired_rows
-- as JSON before its table is dropped, carrying product_id where the row had
-- one, so it stays under the ordinary company erasure and export. No live table
-- holds a foreign key to any of these, and no trigger or view elsewhere names
-- them; that was checked against the built schema before this was written.
--
-- The code before this deletion is commit 1864d6dc.
-- =============================================================================

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_accuracy_scores', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'prediction_type', prediction_type, 'period_start', period_start,
  'total_predictions', total_predictions,
  'measured_predictions', measured_predictions,
  'correct_predictions', correct_predictions, 'accuracy_rate', accuracy_rate,
  'avg_confidence', avg_confidence, 'calibration_score', calibration_score,
  'updated_at', updated_at)
FROM agent_accuracy_scores;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_config_history', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'config_type', config_type, 'version', version, 'content', content,
  'changed_at', changed_at, 'changed_by', changed_by, 'rationale', rationale,
  'session_id', session_id, 'gate_scores', gate_scores)
FROM agent_config_history;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_configs', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'config_type', config_type, 'content', content, 'version', version,
  'parent_version', parent_version, 'line_count', line_count,
  'word_count', word_count, 'updated_at', updated_at, 'updated_by', updated_by)
FROM agent_configs;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_cost_log', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'session_id', session_id, 'tokens_input', tokens_input,
  'tokens_output', tokens_output, 'cost_usd', cost_usd,
  'attributed_revenue_usd', attributed_revenue_usd, 'action_type', action_type,
  'logged_at', logged_at)
FROM agent_cost_log;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_evolution_versions', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'version', version, 'change_type', change_type,
  'change_description', change_description,
  'trigger_session_id', trigger_session_id, 'previous_config', previous_config,
  'new_config', new_config, 'validation_score', validation_score,
  'validation_notes', validation_notes, 'promoted_at', promoted_at,
  'created_at', created_at)
FROM agent_evolution_versions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_initiative_queue', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'initiative_type', initiative_type, 'description', description,
  'context', context, 'priority', priority, 'status', status,
  'created_at', created_at, 'processed_at', processed_at)
FROM agent_initiative_queue;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_predictions', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'session_id', session_id, 'prediction_type', prediction_type,
  'prediction_text', prediction_text, 'predicted_value', predicted_value,
  'confidence', confidence, 'measure_by_date', measure_by_date,
  'outcome_criteria', outcome_criteria, 'outcome', outcome,
  'outcome_measured_at', outcome_measured_at, 'outcome_notes', outcome_notes,
  'accuracy_score', accuracy_score, 'created_at', created_at)
FROM agent_predictions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_remediations', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'session_id', session_id, 'remediation_type', remediation_type,
  'title', title, 'description', description, 'severity', severity,
  'status', status, 'estimated_effort', estimated_effort,
  'affected_area', affected_area, 'suggested_fix', suggested_fix,
  'github_issue_url', github_issue_url, 'resolved_at', resolved_at,
  'dismissed_reason', dismissed_reason, 'created_at', created_at,
  'updated_at', updated_at)
FROM agent_remediations;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_scratchpad', product_id, json_object(
  'id', id, 'product_id', product_id, 'scratchpad_date', scratchpad_date,
  'findings_json', findings_json,
  'consensus_points_json', consensus_points_json,
  'conflict_points_json', conflict_points_json, 'updated_at', updated_at)
FROM agent_scratchpad;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'competitor_profiles', product_id, json_object(
  'id', id, 'product_id', product_id, 'name', name, 'url', url,
  'known_features', known_features, 'pricing_summary', pricing_summary,
  'estimated_traffic', estimated_traffic, 'top_keywords', top_keywords,
  'our_advantages', our_advantages, 'their_advantages', their_advantages,
  'threat_level', threat_level, 'recommended_response', recommended_response,
  'last_scanned_at', last_scanned_at, 'created_at', created_at)
FROM competitor_profiles;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'debate_sessions', product_id, json_object(
  'id', id, 'product_id', product_id, 'briefing_date', briefing_date,
  'status', status, 'positions_json', positions_json,
  'conflicts_json', conflicts_json, 'synthesis_json', synthesis_json,
  'confidence_weights_json', confidence_weights_json, 'created_at', created_at,
  'completed_at', completed_at)
FROM debate_sessions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'decision_outcomes', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'session_id', session_id, 'decision_title', decision_title,
  'decision_description', decision_description, 'outcome', outcome,
  'outcome_result', outcome_result, 'founder_rationale', founder_rationale,
  'impact_usd', impact_usd, 'context_json', context_json,
  'resolved_at', resolved_at, 'created_at', created_at)
FROM decision_outcomes;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'evolved_prompts', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'prompt_version', prompt_version, 'mutation_type', mutation_type,
  'base_prompt_hash', base_prompt_hash,
  'delta_instructions', delta_instructions, 'reasoning', reasoning,
  'predictions_before', predictions_before, 'accuracy_before', accuracy_before,
  'predictions_after', predictions_after, 'accuracy_after', accuracy_after,
  'is_active', is_active, 'created_at', created_at,
  'activated_at', activated_at)
FROM evolved_prompts;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'founder_behavioral_signals', product_id, json_object(
  'id', id, 'product_id', product_id, 'signal_type', signal_type,
  'signal_description', signal_description, 'severity', severity,
  'detected_at', detected_at, 'context_json', context_json)
FROM founder_behavioral_signals;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'founder_state_assessments', product_id, json_object(
  'id', id, 'product_id', product_id, 'assessed_at', assessed_at,
  'state', state, 'confidence', confidence,
  'contributing_signals_json', contributing_signals_json,
  'recommendation', recommendation,
  'recommended_deferral_hours', recommended_deferral_hours)
FROM founder_state_assessments;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'golden_suite', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'lesson_type', lesson_type, 'input_context', input_context,
  'expected_behavior', expected_behavior, 'lesson', lesson, 'source', source,
  'confidence', confidence, 'times_reinforced', times_reinforced,
  'active', active, 'created_at', created_at, 'updated_at', updated_at)
FROM golden_suite;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'integration_sync_log', product_id, json_object(
  'id', id, 'integration_id', integration_id, 'product_id', product_id,
  'started_at', started_at, 'completed_at', completed_at, 'status', status,
  'records_processed', records_processed, 'metrics_updated', metrics_updated,
  'error_message', error_message, 'provider', provider, 'sync_type', sync_type,
  'errors', errors, 'duration_ms', duration_ms)
FROM integration_sync_log;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'intelligence_benchmarks', NULL, json_object(
  'id', id, 'metric_name', metric_name, 'cohort', cohort, 'p25', p25,
  'p50', p50, 'p75', p75, 'p90', p90, 'cohort_size', cohort_size,
  'computed_at', computed_at)
FROM intelligence_benchmarks;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'lifecycle_rule_triggers', product_id, json_object(
  'id', id, 'rule_id', rule_id, 'product_id', product_id,
  'customer_id', customer_id, 'triggered_at', triggered_at, 'outcome', outcome,
  'outbound_action_id', outbound_action_id)
FROM lifecycle_rule_triggers;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'outbound_rate_limits', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'integration_name', integration_name, 'action_type', action_type,
  'max_per_hour', max_per_hour, 'max_per_day', max_per_day,
  'current_hour_count', current_hour_count,
  'current_day_count', current_day_count, 'hour_reset_at', hour_reset_at,
  'day_reset_at', day_reset_at)
FROM outbound_rate_limits;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'outcome_trees', product_id, json_object(
  'id', id, 'product_id', product_id, 'parent_branch_id', parent_branch_id,
  'label', label, 'metric_key', metric_key, 'current_value', current_value,
  'target_value', target_value, 'unit', unit, 'kill_criterion', kill_criterion,
  'status', status, 'killed_at', killed_at, 'killed_reason', killed_reason,
  'achieved_at', achieved_at, 'generated_at', generated_at,
  'weekly_refresh_run_id', weekly_refresh_run_id)
FROM outcome_trees;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'pattern_matches', product_id, json_object(
  'id', id, 'product_id', product_id, 'failure_pattern_id', failure_pattern_id,
  'match_score', match_score, 'matched_signals_json', matched_signals_json,
  'first_detected_at', first_detected_at, 'last_checked_at', last_checked_at,
  'resolved_at', resolved_at, 'outcome', outcome)
FROM pattern_matches;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'phase_beta_proposals', product_id, json_object(
  'id', id, 'product_id', product_id, 'source_type', source_type,
  'source_id', source_id, 'proposed_change', proposed_change,
  'proposed_by', proposed_by, 'rationale', rationale, 'blocked_at', blocked_at,
  'blocked_during_freeze_id', blocked_during_freeze_id, 'status', status,
  'reviewed_at', reviewed_at, 'reviewed_by', reviewed_by,
  'review_notes', review_notes)
FROM phase_beta_proposals;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'playbook_trigger_log', product_id, json_object(
  'id', id, 'playbook_id', playbook_id, 'product_id', product_id,
  'evaluation_result', evaluation_result,
  'condition_snapshot_json', condition_snapshot_json,
  'action_execution_id', action_execution_id, 'triggered_at', triggered_at)
FROM playbook_trigger_log;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'priority_actions', product_id, json_object(
  'id', id, 'product_id', product_id, 'title', title,
  'description', description, 'urgency_score', urgency_score,
  'impact_score', impact_score, 'priority_score', priority_score,
  'source', source, 'source_id', source_id, 'action_type', action_type,
  'action_url', action_url, 'deadline_hours', deadline_hours,
  'is_active', is_active, 'created_at', created_at,
  'dismissed_at', dismissed_at, 'completed_at', completed_at)
FROM priority_actions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'revenue_attributions', product_id, json_object(
  'id', id, 'product_id', product_id, 'attribution_type', attribution_type,
  'agent_name', agent_name, 'amount_usd', amount_usd, 'confidence', confidence,
  'description', description, 'evidence_json', evidence_json,
  'period_start', period_start, 'period_end', period_end,
  'created_at', created_at)
FROM revenue_attributions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'scp_briefings', product_id, json_object(
  'id', id, 'product_id', product_id, 'briefing_date', briefing_date,
  'signal_score', signal_score, 'risk_state', risk_state,
  'health_score', health_score, 'headline', headline,
  'full_briefing', full_briefing, 'agent_contributions', agent_contributions,
  'pending_decisions', pending_decisions,
  'overnight_actions', overnight_actions,
  'experiments_running', experiments_running,
  'financial_summary', financial_summary, 'lifecycle_state', lifecycle_state,
  'tokens_used', tokens_used, 'cost_usd', cost_usd,
  'generated_by', generated_by, 'created_at', created_at)
FROM scp_briefings;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'scp_constitutions', product_id, json_object(
  'id', id, 'product_id', product_id, 'version', version,
  'core_values', core_values, 'operating_principles', operating_principles,
  'authority_framework', authority_framework,
  'evolution_policy', evolution_policy, 'created_at', created_at,
  'updated_at', updated_at)
FROM scp_constitutions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'strategic_syntheses', product_id, json_object(
  'id', id, 'product_id', product_id, 'generated_at', generated_at,
  'period_start', period_start, 'period_end', period_end,
  'market_position', market_position,
  'customer_intelligence', customer_intelligence,
  'product_direction', product_direction, 'risks', risks,
  'top_opportunities', top_opportunities,
  'recommended_priorities', recommended_priorities,
  'ceo_decision_needed', ceo_decision_needed, 'full_synthesis', full_synthesis,
  'tokens_used', tokens_used, 'cost_usd', cost_usd)
FROM strategic_syntheses;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'team_health_metrics', product_id, json_object(
  'id', id, 'product_id', product_id, 'week_starting', week_starting,
  'critique_pass_rate_pct', critique_pass_rate_pct,
  'total_critiques', total_critiques,
  'critiques_resulting_in_change', critiques_resulting_in_change,
  'override_rate_pct', override_rate_pct,
  'total_decisions_resolved', total_decisions_resolved,
  'decisions_overridden', decisions_overridden,
  'evolutions_promoted_count', evolutions_promoted_count,
  'recursive_yield_score', recursive_yield_score,
  'decisions_queued', decisions_queued,
  'decisions_resolved', decisions_resolved,
  'median_time_to_action_hours', median_time_to_action_hours,
  'action_accuracy_pct', action_accuracy_pct, 'computed_at', computed_at)
FROM team_health_metrics;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'weekly_compressed_briefs', product_id, json_object(
  'id', id, 'product_id', product_id, 'week_of', week_of,
  'health_score', health_score, 'health_trend', health_trend,
  'one_sentence_status', one_sentence_status,
  'top_3_this_week', top_3_this_week, 'metrics_delta_json', metrics_delta_json,
  'agent_consensus', agent_consensus,
  'one_decision_to_make', one_decision_to_make,
  'estimated_read_minutes', estimated_read_minutes,
  'generated_at', generated_at)
FROM weekly_compressed_briefs;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'wisdom_patterns', product_id, json_object(
  'id', id, 'product_id', product_id, 'pattern_type', pattern_type,
  'agent_name', agent_name, 'pattern', pattern,
  'evidence_count', evidence_count, 'confidence', confidence,
  'supporting_decision_ids', supporting_decision_ids, 'active', active,
  'last_reinforced_at', last_reinforced_at, 'created_at', created_at,
  'updated_at', updated_at)
FROM wisdom_patterns;

DROP TABLE IF EXISTS agent_accuracy_scores;
DROP TABLE IF EXISTS agent_config_history;
DROP TABLE IF EXISTS agent_configs;
DROP TABLE IF EXISTS agent_cost_log;
DROP TABLE IF EXISTS agent_evolution_versions;
DROP TABLE IF EXISTS agent_initiative_queue;
DROP TABLE IF EXISTS agent_predictions;
DROP TABLE IF EXISTS agent_remediations;
DROP TABLE IF EXISTS agent_scratchpad;
DROP TABLE IF EXISTS competitor_profiles;
DROP TABLE IF EXISTS debate_sessions;
DROP TABLE IF EXISTS decision_outcomes;
DROP TABLE IF EXISTS evolved_prompts;
DROP TABLE IF EXISTS founder_behavioral_signals;
DROP TABLE IF EXISTS founder_state_assessments;
DROP TABLE IF EXISTS golden_suite;
DROP TABLE IF EXISTS integration_sync_log;
DROP TABLE IF EXISTS intelligence_benchmarks;
DROP TABLE IF EXISTS lifecycle_rule_triggers;
DROP TABLE IF EXISTS outbound_rate_limits;
DROP TABLE IF EXISTS outcome_trees;
DROP TABLE IF EXISTS pattern_matches;
DROP TABLE IF EXISTS phase_beta_proposals;
DROP TABLE IF EXISTS playbook_trigger_log;
DROP TABLE IF EXISTS priority_actions;
DROP TABLE IF EXISTS revenue_attributions;
DROP TABLE IF EXISTS scp_briefings;
DROP TABLE IF EXISTS scp_constitutions;
DROP TABLE IF EXISTS strategic_syntheses;
DROP TABLE IF EXISTS team_health_metrics;
DROP TABLE IF EXISTS weekly_compressed_briefs;
DROP TABLE IF EXISTS wisdom_patterns;

-- And the second ring, found by running the gate again rather than by
-- guessing (as in migration 309). These four were reachable only as the
-- parents of tables dropped above: the agents' sessions, the playbooks and
-- failure patterns their loops evaluated, and the freeze periods their
-- proposals were held against. Nothing else holds a key to them.

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'agent_sessions', product_id, json_object(
  'id', id, 'product_id', product_id, 'agent_name', agent_name,
  'agent_version', agent_version, 'status', status,
  'observations', observations, 'actions_taken', actions_taken,
  'pending_decisions', pending_decisions,
  'briefing_contribution', briefing_contribution,
  'briefing_priority', briefing_priority,
  'evolution_candidates', evolution_candidates, 'tokens_used', tokens_used,
  'cost_usd', cost_usd, 'error_message', error_message,
  'started_at', started_at, 'completed_at', completed_at)
FROM agent_sessions;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'execution_playbooks', product_id, json_object(
  'id', id, 'product_id', product_id, 'name', name, 'description', description,
  'trigger_type', trigger_type, 'trigger_config_json', trigger_config_json,
  'action_type', action_type, 'action_config_json', action_config_json,
  'auto_execute', auto_execute,
  'execution_budget_weekly', execution_budget_weekly, 'is_active', is_active,
  'created_at', created_at, 'last_evaluated_at', last_evaluated_at,
  'last_triggered_at', last_triggered_at)
FROM execution_playbooks;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'failure_patterns', NULL, json_object(
  'id', id, 'pattern_name', pattern_name, 'description', description,
  'category', category, 'warning_signals_json', warning_signals_json,
  'typical_lead_time_days', typical_lead_time_days,
  'mitigation_actions_json', mitigation_actions_json,
  'match_criteria_json', match_criteria_json, 'severity', severity,
  'created_at', created_at)
FROM failure_patterns;

INSERT INTO retired_rows (table_name, product_id, row_json)
SELECT 'freeze_periods', product_id, json_object(
  'id', id, 'product_id', product_id, 'scope', scope, 'reason', reason,
  'started_at', started_at, 'expected_end_at', expected_end_at,
  'ended_at', ended_at, 'ended_by', ended_by, 'created_at', created_at)
FROM freeze_periods;

DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS execution_playbooks;
DROP TABLE IF EXISTS failure_patterns;
DROP TABLE IF EXISTS freeze_periods;
