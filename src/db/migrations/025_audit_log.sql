-- Migration 025: Immutable audit trail
-- Append-only log of all significant system events.
-- IMPORTANT: No UPDATE or DELETE should ever be performed on this table.

-- agent_audit_log: records every meaningful action taken by agents, founders, or the system
-- actor_type distinguishes who performed the event
-- target_type / target_id identify the entity that was affected
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  event_type    TEXT NOT NULL,   -- e.g. 'action_executed','decision_approved','decision_rejected',
                                  --      'config_changed','agent_evolved','integration_connected',
                                  --      'api_key_created','role_granted'
  actor_type    TEXT NOT NULL,   -- 'agent' | 'founder' | 'system' | 'api'
  actor_id      TEXT,            -- agent name, founder_id, or 'system'
  target_type   TEXT,            -- 'customer','agent','experiment','integration','config',etc.
  target_id     TEXT,
  description   TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',  -- arbitrary structured context
  ip_address    TEXT,            -- set when actor_type = 'founder' or 'api'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes support the most common query patterns: by product, by event type, by time
CREATE INDEX IF NOT EXISTS idx_audit_log_product    ON agent_audit_log(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON agent_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON agent_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON agent_audit_log(actor_type, actor_id);
