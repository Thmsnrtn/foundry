-- =============================================================================
-- Migration 004: Sector Profile System
-- Adds sector-aware scoring overrides and remediation templates.
-- =============================================================================

ALTER TABLE products ADD COLUMN sector_profile TEXT DEFAULT 'b2b_saas';

CREATE TABLE IF NOT EXISTS sector_scoring_overrides (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  dimension TEXT NOT NULL,
  weight_override REAL,
  passing_threshold_override REAL,
  critical_findings_override TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sector_remediation_templates (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  dimension TEXT NOT NULL,
  tone TEXT DEFAULT 'standard',
  template_context TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed healthcare overrides
INSERT OR IGNORE INTO sector_scoring_overrides (id, sector, dimension, weight_override, passing_threshold_override, critical_findings_override) VALUES
  ('sso-healthcare-d5', 'healthcare', 'd5', 0.20, NULL, '["hipaa_compliance"]'),
  ('sso-education-d6', 'education', 'd6', NULL, NULL, '["no_monthly_billing"]'),
  ('sso-government-d5', 'government', 'd5', 0.25, NULL, '["ato_fedramp"]'),
  ('sso-government-d9', 'government', 'd9', NULL, NULL, '["ato_fedramp"]'),
  ('sso-consumer-d10', 'consumer', 'd10', 0.15, NULL, NULL),
  ('sso-consumer-d4', 'consumer', 'd4', 0.15, NULL, NULL),
  ('sso-marketplace-d3', 'marketplace', 'd3', NULL, NULL, '["trust_infrastructure"]'),
  ('sso-marketplace-d1', 'marketplace', 'd1', NULL, NULL, '["liquidity_metrics"]'),
  ('sso-devtools-d1', 'developer_tools', 'd1', 0.20, NULL, NULL),
  ('sso-devtools-d7', 'developer_tools', 'd7', 0.15, NULL, NULL),
  ('sso-fintech-d6', 'fintech', 'd6', 0.20, NULL, NULL),
  ('sso-fintech-d5', 'fintech', 'd5', NULL, NULL, '["financial_compliance"]');
