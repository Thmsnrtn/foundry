-- =============================================================================
-- Migration 010: Co-Founder Alignment Module
-- Tracks multi-founder DNA divergence, decision attribution, gate agreements.
-- =============================================================================

CREATE TABLE IF NOT EXISTS cofounder_profiles (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  founder_id TEXT NOT NULL,
  role TEXT,
  equity_percentage REAL,
  joined_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cofounder_dna_responses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  founder_id TEXT NOT NULL,
  dna_field TEXT NOT NULL,
  response TEXT NOT NULL,
  responded_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, founder_id, dna_field)
);

CREATE TABLE IF NOT EXISTS cofounder_alignment_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  score_date TEXT NOT NULL,
  overall_alignment REAL,
  vision_alignment REAL,
  priority_alignment REAL,
  risk_alignment REAL,
  divergence_axis TEXT,
  recommendations TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cofounder_gate_agreements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  decision_category TEXT NOT NULL,
  gate_level INTEGER NOT NULL,
  proposer_founder_id TEXT,
  requires_unanimous INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, decision_category)
);

CREATE INDEX IF NOT EXISTS idx_cf_profiles_product ON cofounder_profiles(product_id);
CREATE INDEX IF NOT EXISTS idx_cf_dna_product ON cofounder_dna_responses(product_id, founder_id);
CREATE INDEX IF NOT EXISTS idx_cf_alignment_product ON cofounder_alignment_scores(product_id);
CREATE INDEX IF NOT EXISTS idx_cf_gates_product ON cofounder_gate_agreements(product_id);
