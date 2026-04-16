-- =============================================================================
-- FOUNDRY — Exit & Liquidity Layer (Migration 050)
-- M&A readiness scores, acquirer tracking, cap table scenarios, term sheets.
-- =============================================================================

-- M&A Readiness Scores (algorithmic, like fundraising readiness)
CREATE TABLE IF NOT EXISTS ma_readiness_scores (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  assessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  overall_score REAL NOT NULL, -- 0-10
  -- Dimension scores
  revenue_quality_score REAL NOT NULL, -- MRR predictability, NRR, churn
  ip_clarity_score REAL NOT NULL, -- code ownership, no IP disputes, clean licenses
  team_retention_score REAL NOT NULL, -- key person risk, vesting cliffs
  integration_complexity_score REAL NOT NULL, -- API quality, data portability, tech debt
  customer_concentration_score REAL NOT NULL, -- no single customer > 20% revenue
  -- Output
  ready_to_be_acquired INTEGER NOT NULL DEFAULT 0, -- boolean
  key_gaps_json TEXT NOT NULL, -- JSON array of gaps
  target_acquirer_profile TEXT, -- what kind of acquirer would pay a premium
  estimated_multiple_range TEXT -- e.g. "5-8x ARR"
);
CREATE INDEX IF NOT EXISTS idx_ma_readiness_product ON ma_readiness_scores(product_id, assessed_at DESC);

-- Strategic Acquirer Tracking
CREATE TABLE IF NOT EXISTS acquirer_signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  acquirer_name TEXT NOT NULL,
  acquirer_type TEXT NOT NULL, -- 'strategic' | 'financial' | 'pe'
  signal_type TEXT NOT NULL, -- 'product_gap' | 'hiring_signal' | 'partnership_interest' | 'competitor_acquisition' | 'manual'
  signal_description TEXT NOT NULL,
  fit_score REAL NOT NULL DEFAULT 0.5, -- 0-1 how good a fit
  strategic_rationale TEXT, -- why this acquirer would want us
  notes TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acquirer_signals_product ON acquirer_signals(product_id, detected_at DESC);

-- Cap Table Scenarios
CREATE TABLE IF NOT EXISTS cap_table_scenarios (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL, -- 'current', 'series_a', 'acquisition_50m', etc.
  exit_valuation REAL, -- null for current state
  -- Stakeholder breakdown (JSON array of {name, type, shares, options, pct_ownership})
  stakeholders_json TEXT NOT NULL,
  -- Computed outcomes at this exit valuation
  founder_proceeds REAL,
  total_dilution_pct REAL,
  preference_waterfall_json TEXT, -- JSON: how liquidation preferences stack
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cap_table_product ON cap_table_scenarios(product_id);

-- Term Sheet Models
CREATE TABLE IF NOT EXISTS term_sheet_models (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  round_type TEXT NOT NULL, -- 'seed' | 'series_a' | 'series_b'
  modeled_valuation REAL NOT NULL,
  -- Key terms
  investment_amount REAL NOT NULL,
  pre_money_valuation REAL NOT NULL,
  liquidation_preference TEXT NOT NULL DEFAULT '1x_non_participating',
  anti_dilution TEXT NOT NULL DEFAULT 'broad_based_weighted_avg',
  pro_rata_rights INTEGER NOT NULL DEFAULT 1,
  board_seats INTEGER NOT NULL DEFAULT 1,
  -- Computed
  post_money_valuation REAL NOT NULL,
  new_dilution_pct REAL NOT NULL,
  investor_ownership_pct REAL NOT NULL,
  founder_retention_pct REAL,
  -- Comp analysis
  market_context TEXT, -- Claude-generated commentary on how these terms compare to market
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_term_sheet_product ON term_sheet_models(product_id, created_at DESC);
