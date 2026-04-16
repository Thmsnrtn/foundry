-- FOUNDRY — Migration 022: Customer Lifecycle Engine + Inter-Agent Communication
-- Customer intelligence model, lifecycle automation rules, and agent message bus.

-- Customer intelligence model - one row per customer per product
CREATE TABLE IF NOT EXISTS customer_intelligence (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  external_customer_id TEXT NOT NULL,  -- Stripe customer ID or email
  account_name TEXT,
  email TEXT,

  -- Lifecycle stage
  stage TEXT NOT NULL DEFAULT 'trial' CHECK(stage IN (
    'visitor','trial','activated','paying','at_risk','churned','expansion','advocate'
  )),
  stage_entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Health composite (0-100)
  health_score REAL DEFAULT 50.0,
  login_frequency_score REAL DEFAULT 50.0,
  feature_depth_score REAL DEFAULT 50.0,
  support_sentiment_score REAL DEFAULT 50.0,
  billing_health_score REAL DEFAULT 100.0,
  engagement_trend TEXT DEFAULT 'stable' CHECK(engagement_trend IN ('improving','stable','declining')),

  -- Behavioral
  primary_use_case TEXT,
  features_used TEXT DEFAULT '[]',       -- JSON: string[]
  activation_complete INTEGER DEFAULT 0,  -- BOOLEAN
  last_active_at DATETIME,

  -- Revenue
  mrr_cents INTEGER DEFAULT 0,
  lifetime_value_cents INTEGER DEFAULT 0,
  plan TEXT,
  expansion_eligible INTEGER DEFAULT 0,  -- BOOLEAN
  upsell_signals TEXT DEFAULT '[]',      -- JSON: string[]

  -- Communication
  last_contacted_at DATETIME,
  last_contacted_by TEXT,               -- Agent name
  preferred_channel TEXT DEFAULT 'email',
  do_not_contact_until DATETIME,        -- Rate limiting

  -- Agent notes (append-only log)
  agent_notes TEXT DEFAULT '[]',        -- JSON: [{agent, note, timestamp}]

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, external_customer_id)
);

-- Lifecycle automation rules
CREATE TABLE IF NOT EXISTS lifecycle_rules (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- Trigger
  trigger_event TEXT NOT NULL,          -- 'health_score_dropped', 'stage_changed', 'days_since_login', 'trial_day_X', 'payment_failed'
  trigger_conditions TEXT NOT NULL,     -- JSON: {threshold?, stage?, days?}

  -- Action
  action_agent TEXT NOT NULL,
  action_type TEXT NOT NULL,            -- 'send_email', 'create_remediation', 'escalate_to_ceo', 'add_note'
  action_parameters TEXT NOT NULL,      -- JSON
  authority_level INTEGER NOT NULL DEFAULT 1,

  -- Control
  enabled INTEGER DEFAULT 1,
  cooldown_hours INTEGER DEFAULT 72,    -- Don't re-trigger for same customer within N hours

  -- Performance
  times_triggered INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,

  created_by TEXT DEFAULT 'system',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent-to-agent message bus
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,              -- Agent name or 'broadcast'
  type TEXT NOT NULL CHECK(type IN ('insight','request','alert','handoff','question','report')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  context_json TEXT DEFAULT '{}',
  requires_response INTEGER DEFAULT 0,  -- BOOLEAN
  response_deadline DATETIME,
  responded_at DATETIME,
  response_id TEXT,                     -- ID of response message
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track lifecycle rule cooldowns (prevent re-triggering too soon)
CREATE TABLE IF NOT EXISTS lifecycle_rule_triggers (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES lifecycle_rules(id),
  product_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  outcome TEXT,                         -- 'success', 'failure', 'pending'
  outbound_action_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_intel_product ON customer_intelligence(product_id, stage);
CREATE INDEX IF NOT EXISTS idx_customer_intel_health ON customer_intelligence(product_id, health_score);
CREATE INDEX IF NOT EXISTS idx_customer_intel_external ON customer_intelligence(product_id, external_customer_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_rules_product ON lifecycle_rules(product_id, enabled);
CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(product_id, to_agent, read_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(product_id, from_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_unread ON agent_messages(product_id, to_agent) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rule_triggers_cooldown ON lifecycle_rule_triggers(rule_id, customer_id, triggered_at DESC);
