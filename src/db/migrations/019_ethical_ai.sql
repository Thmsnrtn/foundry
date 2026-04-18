-- =============================================================================
-- Migration 019: Ethical AI Assessment
-- Evaluates AI products for fairness, consent, safety, and social license.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ethical_assessment (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  has_ai_components INTEGER DEFAULT 0,
  demographic_fairness_score REAL,
  consent_adequacy_score REAL,
  minor_user_risk TEXT DEFAULT 'none',
  claims_substantiation_score REAL,
  surveillance_proportionality_score REAL,
  crisis_safety_score REAL,
  social_license_risk TEXT DEFAULT 'low',
  overall_ethics_score REAL,
  findings TEXT,
  assessed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ethics_product ON ethical_assessment(product_id);
