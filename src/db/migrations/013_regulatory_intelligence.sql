-- =============================================================================
-- Migration 013: Regulatory Intelligence Module
-- Compliance tracking, regulatory change monitoring.
-- =============================================================================

CREATE TABLE IF NOT EXISTS regulatory_profile (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  jurisdictions TEXT,
  regulatory_classifications TEXT,
  compliance_requirements TEXT,
  compliance_debt_score REAL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id)
);

CREATE TABLE IF NOT EXISTS regulatory_changes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  description TEXT NOT NULL,
  impact_level TEXT DEFAULT 'medium',
  effective_date TEXT,
  source TEXT,
  action_required TEXT,
  status TEXT DEFAULT 'active',
  detected_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reg_profile_product ON regulatory_profile(product_id);
CREATE INDEX IF NOT EXISTS idx_reg_changes_product ON regulatory_changes(product_id);
CREATE INDEX IF NOT EXISTS idx_reg_changes_status ON regulatory_changes(status);
