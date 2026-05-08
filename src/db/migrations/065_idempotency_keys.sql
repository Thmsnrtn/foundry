-- =============================================================================
-- FOUNDRY — V3.1 Layer C: Generalized Idempotency Keys
-- Per-product outbound-action dedup keyed on (product_id, action_type,
-- dedup_key). Distinct from the older `webhook_idempotency` table which is
-- webhook-specific event dedup; both coexist. The gateway uses this table
-- for at-most-once semantics on send_email, create_pr, publish_content,
-- update_config, etc.
-- =============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_id TEXT,                                  -- agent name; NULL for system actions
  action_type TEXT NOT NULL,                      -- 'send_email'|'create_pr'|...
  dedup_key TEXT NOT NULL,                        -- caller-supplied idempotency key
  result_json TEXT,                               -- cached result; populated by storeResult
  expires_at TEXT NOT NULL,                       -- ISO timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idem_unique
  ON idempotency_keys(product_id, action_type, dedup_key);
CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);
