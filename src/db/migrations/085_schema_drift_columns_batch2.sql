-- =============================================================================
-- Migration 085: Add columns live subsystems write but the schema lacks
-- (schema-drift audit — INSERT-column mismatches, batch 2).
--
-- All of these subsystems are live and will see more work, so the fix is to
-- make the schema carry what the code writes (additive, backward-compatible) —
-- not to delete the feature. Companion code remaps land in the same commit for
-- cases where an equivalent column already existed.
--
--   • metric_snapshots  — the /api/v1/metrics ingestion endpoint accepts raw
--     mrr + customer counts.
--   • webhook_deliveries — the delivery recorder logs the request payload,
--     attempt number, and failure time.
--   • webhooks           — the /api/v1/webhooks API is product-scoped and
--     records who created the endpoint (the founder-scoped columns remain).
--   • api_keys           — the RBAC key issuer (services/rbac/permissions.ts)
--     scopes keys to a product with a role + scope list.
-- =============================================================================

ALTER TABLE metric_snapshots ADD COLUMN mrr_cents INTEGER;
ALTER TABLE metric_snapshots ADD COLUMN new_customers INTEGER;
ALTER TABLE metric_snapshots ADD COLUMN churned_customers INTEGER;

ALTER TABLE webhook_deliveries ADD COLUMN payload_json TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN attempt_count INTEGER;
ALTER TABLE webhook_deliveries ADD COLUMN failed_at DATETIME;

ALTER TABLE webhooks ADD COLUMN product_id TEXT;
ALTER TABLE webhooks ADD COLUMN created_by TEXT;

ALTER TABLE api_keys ADD COLUMN product_id TEXT;
ALTER TABLE api_keys ADD COLUMN role TEXT;
ALTER TABLE api_keys ADD COLUMN scopes TEXT;
ALTER TABLE api_keys ADD COLUMN created_by TEXT;
