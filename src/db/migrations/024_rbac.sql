-- Migration 024: Role-based access control
-- Provides org-level and product-level roles for founders, plus API key management.

-- account_roles: maps founders to roles, optionally scoped to a product
-- product_id NULL means the role applies at the org/account level
CREATE TABLE IF NOT EXISTS account_roles (
  id           TEXT PRIMARY KEY,
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  product_id   TEXT REFERENCES products(id),       -- NULL = org-level role
  role         TEXT NOT NULL CHECK (role IN ('owner','operator','investor','advisor','viewer')),
  granted_by   TEXT,                                -- founder_id or 'system'
  granted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,                                -- NULL means currently active
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_roles_founder ON account_roles(founder_id);
CREATE INDEX IF NOT EXISTS idx_account_roles_product ON account_roles(product_id);

-- role_permissions: static capability map for each role
-- permissions follow a 'resource:action' naming convention
CREATE TABLE IF NOT EXISTS role_permissions (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique ON role_permissions(role, permission);

-- Seed default permissions for each role
-- owner: full access to everything
INSERT OR IGNORE INTO role_permissions (id, role, permission) VALUES
  ('rp_owner_agents_read',          'owner', 'agents:read'),
  ('rp_owner_agents_write',         'owner', 'agents:write'),
  ('rp_owner_decisions_approve',    'owner', 'decisions:approve'),
  ('rp_owner_decisions_read',       'owner', 'decisions:read'),
  ('rp_owner_experiments_read',     'owner', 'experiments:read'),
  ('rp_owner_experiments_write',    'owner', 'experiments:write'),
  ('rp_owner_financials_read',      'owner', 'financials:read'),
  ('rp_owner_strategy_read',        'owner', 'strategy:read'),
  ('rp_owner_customers_read',       'owner', 'customers:read'),
  ('rp_owner_customers_write',      'owner', 'customers:write'),
  ('rp_owner_config_read',          'owner', 'config:read'),
  ('rp_owner_config_write',         'owner', 'config:write'),
  ('rp_owner_integrations_manage',  'owner', 'integrations:manage');

-- operator: can read/write most things but cannot manage integrations or config
INSERT OR IGNORE INTO role_permissions (id, role, permission) VALUES
  ('rp_operator_agents_read',       'operator', 'agents:read'),
  ('rp_operator_agents_write',      'operator', 'agents:write'),
  ('rp_operator_decisions_approve', 'operator', 'decisions:approve'),
  ('rp_operator_decisions_read',    'operator', 'decisions:read'),
  ('rp_operator_experiments_read',  'operator', 'experiments:read'),
  ('rp_operator_experiments_write', 'operator', 'experiments:write'),
  ('rp_operator_financials_read',   'operator', 'financials:read'),
  ('rp_operator_strategy_read',     'operator', 'strategy:read'),
  ('rp_operator_customers_read',    'operator', 'customers:read'),
  ('rp_operator_customers_write',   'operator', 'customers:write'),
  ('rp_operator_config_read',       'operator', 'config:read');

-- investor: read-only access to financials and strategy; no customers or agents
INSERT OR IGNORE INTO role_permissions (id, role, permission) VALUES
  ('rp_investor_financials_read',   'investor', 'financials:read'),
  ('rp_investor_strategy_read',     'investor', 'strategy:read'),
  ('rp_investor_experiments_read',  'investor', 'experiments:read'),
  ('rp_investor_decisions_read',    'investor', 'decisions:read');

-- advisor: read strategy, experiments, decisions; no financials
INSERT OR IGNORE INTO role_permissions (id, role, permission) VALUES
  ('rp_advisor_strategy_read',      'advisor', 'strategy:read'),
  ('rp_advisor_experiments_read',   'advisor', 'experiments:read'),
  ('rp_advisor_decisions_read',     'advisor', 'decisions:read'),
  ('rp_advisor_agents_read',        'advisor', 'agents:read');

-- viewer: minimal read access
INSERT OR IGNORE INTO role_permissions (id, role, permission) VALUES
  ('rp_viewer_agents_read',         'viewer', 'agents:read'),
  ('rp_viewer_decisions_read',      'viewer', 'decisions:read'),
  ('rp_viewer_experiments_read',    'viewer', 'experiments:read'),
  ('rp_viewer_strategy_read',       'viewer', 'strategy:read');

-- api_keys: programmatic access tokens scoped to a product
-- key_hash stores a bcrypt/SHA-256 hash — raw key is never stored
-- key_prefix (e.g. "fnd_live_abc123") is shown in UI for identification
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL,
  name         TEXT,                               -- human-readable label
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'viewer',
  scopes       TEXT NOT NULL DEFAULT '[]',         -- JSON array of permission strings
  last_used_at TEXT,
  expires_at   TEXT,                               -- NULL = never expires
  created_by   TEXT,                               -- founder_id
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT                                -- NULL = active
);

-- api_keys is founder-scoped in the canonical schema (006_api_keys_webhooks);
-- 024's product_id redefinition is a no-op CREATE, so index the real column
-- (founder_id) instead of the non-existent product_id (Phase 2.4).
CREATE INDEX IF NOT EXISTS idx_api_keys_founder ON api_keys(founder_id);
