-- Preserve provider acknowledgment separately from observed business outcome.
-- Existing delivered_at remains a compatibility timestamp for HTTP 2xx.

ALTER TABLE webhook_deliveries ADD COLUMN effect_certainty TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN provider_acknowledged_at TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN reconcile_after TEXT;
