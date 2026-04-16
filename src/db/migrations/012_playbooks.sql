-- =============================================================================
-- FOUNDRY — Migration 012: Playbooks + Temporal Intelligence
-- Auto-generated founder playbooks from wisdom/DNA/decision history.
-- Prediction accuracy tracking. Business replay snapshots.
-- =============================================================================

-- Generated playbooks: crystallized founder judgment as portable documents.
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'operating_principles',    -- "The [Product] Way" — decision heuristics
    'onboarding_kit',          -- First hire onboarding from DNA + history
    'pricing_framework',       -- How we think about and change pricing
    'churn_response',          -- What we do when churn spikes
    'activation_playbook',     -- How we improve activation
    'fundraising_narrative',   -- Our story for investors
    'competitive_response',    -- How we respond to competitive threats
    'recovery_protocol'        -- What we do in RED state
  )),
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  -- Content sections (Markdown)
  executive_summary TEXT,
  core_principles TEXT,        -- The heuristics derived from decision patterns
  playbook_body TEXT,          -- Main content
  anti_patterns TEXT,          -- What NOT to do (from failure log)
  evidence TEXT,               -- JSON: [{description, decision_id?, stressor_id?, date}]
  -- Meta
  source_decisions INTEGER DEFAULT 0,   -- how many decisions informed this
  source_patterns INTEGER DEFAULT 0,    -- how many judgment patterns
  source_failures INTEGER DEFAULT 0,    -- how many failure log entries
  dna_sections_used TEXT,               -- JSON: string[] — which DNA fields contributed
  is_current BOOLEAN DEFAULT TRUE,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Export state
  notion_page_id TEXT,
  linear_doc_id TEXT,
  exported_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_playbooks_product ON playbooks(product_id, type, is_current);

-- Playbook export requests: async queue for Notion/Linear export.
CREATE TABLE IF NOT EXISTS playbook_exports (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  destination TEXT CHECK(destination IN ('notion', 'linear', 'pdf', 'markdown')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  result_url TEXT,
  error TEXT,
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_playbook_exports_playbook ON playbook_exports(playbook_id);

-- Temporal events: enriched event log for Signal history replay.
-- Captures what happened at each significant moment.
CREATE TABLE IF NOT EXISTS temporal_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,            -- YYYY-MM-DD
  event_type TEXT NOT NULL CHECK(event_type IN (
    'stressor_created', 'stressor_resolved',
    'decision_made', 'decision_outcome',
    'risk_state_change', 'lifecycle_gate',
    'audit_completed', 'remediation_merged',
    'signal_spike', 'signal_drop',
    'milestone', 'integration_connected',
    'cohort_anomaly', 'competitive_signal'
  )),
  title TEXT NOT NULL,                 -- ≤120 chars
  description TEXT,
  entity_type TEXT,                    -- 'decision', 'stressor', 'audit', etc.
  entity_id TEXT,                      -- FK to the relevant entity
  signal_at_event INTEGER,             -- Signal score when event occurred
  signal_delta INTEGER,                -- change from previous day
  metadata TEXT,                       -- JSON: event-specific data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_temporal_events_product ON temporal_events(product_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_temporal_events_type ON temporal_events(product_id, event_type);

-- Prediction accuracy: compare scenario forecasts to actual outcomes.
CREATE TABLE IF NOT EXISTS prediction_accuracy (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scenario_model_id TEXT REFERENCES scenario_models(id),
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  option_chosen TEXT NOT NULL,
  -- Predicted outcomes (from scenario model)
  predicted_mrr_delta_pct REAL,
  predicted_outcome_direction TEXT,
  predicted_timeframe_days INTEGER,
  -- Actual outcomes (filled in after outcome_measured_at)
  actual_mrr_delta_pct REAL,
  actual_outcome_direction TEXT,
  actual_timeframe_days INTEGER,
  -- Accuracy scoring
  direction_correct BOOLEAN,           -- did we predict the direction right?
  magnitude_accuracy REAL,             -- 0.0-1.0
  timeframe_accuracy REAL,             -- 0.0-1.0
  composite_accuracy REAL,             -- weighted aggregate
  measured_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_product ON prediction_accuracy(product_id, measured_at DESC);
