-- =============================================================================
-- FOUNDRY — Migration 023: Experiments, Strategy, and Financial Autonomy
-- Hypotheses, experiments, cost tracking, revenue attribution, strategic synthesis,
-- competitor profiles, and strategic plans.
-- =============================================================================

-- Hypotheses proposed by agents
CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL,             -- Agent name
  validated_by TEXT,                     -- Usually 'oracle'
  statement TEXT NOT NULL,
  null_hypothesis TEXT,
  predicted_effect_size REAL,            -- e.g., 0.15 = 15% improvement
  minimum_detectable_effect REAL,
  required_sample_size INTEGER,
  estimated_duration_days INTEGER,
  confidence_level REAL DEFAULT 0.95,
  risk_assessment TEXT,
  revenue_impact_estimate TEXT,
  estimated_cost_usd REAL,
  predicted_roi REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN (
    'proposed','approved','active','completed','abandoned','disproven'
  )),
  disproven_evidence TEXT,               -- If disproven, why
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Active/completed experiments
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
  name TEXT NOT NULL,
  designed_by TEXT DEFAULT 'oracle',
  type TEXT NOT NULL CHECK(type IN ('ab_test','before_after','cohort_comparison')),
  control_description TEXT NOT NULL,
  treatment_description TEXT NOT NULL,
  success_metric TEXT NOT NULL,          -- e.g., "trial_to_paid_conversion_rate"
  guardrail_metrics TEXT DEFAULT '[]',   -- JSON: metrics that must NOT degrade
  sample_allocation REAL DEFAULT 0.5,    -- % to treatment
  started_at DATETIME,
  planned_end_at DATETIME,
  actual_end_at DATETIME,
  status TEXT NOT NULL DEFAULT 'designed' CHECK(status IN (
    'designed','running','paused','completed','stopped_early','abandoned'
  )),
  early_stop_reason TEXT,
  results_json TEXT,                     -- JSON: {control_mean, treatment_mean, p_value, ci_lower, ci_upper, effect_size, significant}
  winner TEXT CHECK(winner IN ('control','treatment','inconclusive')),
  actual_cost_usd REAL DEFAULT 0.0,
  actual_revenue_impact_usd REAL,
  roi_vs_predicted REAL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Granular cost events (more detailed than agent_cost_log)
CREATE TABLE IF NOT EXISTS cost_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT,                       -- NULL for platform-level
  cost_type TEXT NOT NULL CHECK(cost_type IN (
    'llm_tokens','integration_api','email_send','compute','experiment','other'
  )),
  amount_usd REAL NOT NULL,
  details_json TEXT,                     -- {model, tokens_in, tokens_out} etc.
  session_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Revenue attribution records
CREATE TABLE IF NOT EXISTS revenue_attributions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribution_type TEXT NOT NULL CHECK(attribution_type IN (
    'direct','experiment','contribution','protective'
  )),
  agent_name TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  confidence REAL NOT NULL,
  description TEXT NOT NULL,
  evidence_json TEXT,                    -- {action_id, customer_id, conversion_event}
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategic synthesis (monthly cross-agent analysis)
CREATE TABLE IF NOT EXISTS strategic_syntheses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  market_position TEXT,                  -- Oracle + Beacon analysis
  customer_intelligence TEXT,            -- Harbor + Forge analysis
  product_direction TEXT,                -- Compass analysis
  risks TEXT,                            -- Sentinel + Shield analysis
  top_opportunities TEXT NOT NULL,       -- JSON: [{opportunity, agent, impact, priority}]
  recommended_priorities TEXT NOT NULL,  -- JSON: [{priority, description, owners, expected_impact}]
  ceo_decision_needed TEXT,              -- What requires CEO input
  full_synthesis TEXT NOT NULL,          -- Complete synthesis markdown
  tokens_used INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0.0
);

-- Competitor profiles (extends existing competitive_signals)
CREATE TABLE IF NOT EXISTS competitor_profiles (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  known_features TEXT DEFAULT '[]',      -- JSON: string[]
  pricing_summary TEXT,
  estimated_traffic TEXT,
  top_keywords TEXT DEFAULT '[]',        -- JSON: string[]
  our_advantages TEXT DEFAULT '[]',      -- JSON: string[]
  their_advantages TEXT DEFAULT '[]',    -- JSON: string[]
  threat_level TEXT DEFAULT 'low' CHECK(threat_level IN ('low','medium','high')),
  recommended_response TEXT,
  last_scanned_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, name)
);

-- Rolling strategic plans
CREATE TABLE IF NOT EXISTS strategic_plans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  thirty_day_plan TEXT NOT NULL,
  sixty_day_outlook TEXT NOT NULL,
  ninety_day_horizon TEXT NOT NULL,
  key_assumptions TEXT NOT NULL,
  predicted_outcomes TEXT NOT NULL,
  actual_outcomes TEXT,
  accuracy_score REAL
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_product ON hypotheses(product_id, status);
CREATE INDEX IF NOT EXISTS idx_experiments_product ON experiments(product_id, status);
CREATE INDEX IF NOT EXISTS idx_cost_events_product ON cost_events(product_id, agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_attributions_product ON revenue_attributions(product_id, agent_name, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_strategic_syntheses_product ON strategic_syntheses(product_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_profiles_product ON competitor_profiles(product_id);
