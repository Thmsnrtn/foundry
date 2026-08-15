-- Preserve provider receipt certainty for approved external actions.
ALTER TABLE action_executions ADD COLUMN effect_certainty TEXT;
ALTER TABLE action_executions ADD COLUMN provider_acknowledged_at DATETIME;
ALTER TABLE action_executions ADD COLUMN reconcile_after DATETIME;
