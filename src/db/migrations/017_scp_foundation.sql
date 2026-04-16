-- =============================================================================
-- FOUNDRY — Migration 017: Sovereign Company Protocol Foundation
-- Transforms Foundry from a single-product intelligence tool into the
-- control plane for autonomous AI companies. Each product becomes a company
-- with 12 specialized AI agents that operate, learn, and grow the business.
-- =============================================================================

-- ─── Company Columns on Products ─────────────────────────────────────────────
-- Products are now companies. These columns track SCP state.

ALTER TABLE products ADD COLUMN company_lifecycle_state TEXT DEFAULT 'setup'
  CHECK(company_lifecycle_state IN ('setup', 'learning', 'operating', 'optimizing', 'scaling'));

ALTER TABLE products ADD COLUMN scp_status TEXT DEFAULT 'provisioning'
  CHECK(scp_status IN ('provisioning', 'active', 'paused', 'archived'));

-- Budget & cost tracking per company
ALTER TABLE products ADD COLUMN operating_budget_monthly_usd REAL DEFAULT 50.0;
ALTER TABLE products ADD COLUMN ai_cost_trailing_30d_usd REAL DEFAULT 0.0;
ALTER TABLE products ADD COLUMN attributed_revenue_trailing_30d_usd REAL DEFAULT 0.0;

-- Composite health score (0-100) aggregated across all 12 agents
ALTER TABLE products ADD COLUMN health_score INTEGER DEFAULT 0;

-- SCP constitution versioning
ALTER TABLE products ADD COLUMN scp_constitution_version INTEGER DEFAULT 1;
ALTER TABLE products ADD COLUMN total_evolution_cycles INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN golden_suite_size INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN evolution_enabled INTEGER DEFAULT 1; -- BOOLEAN

-- ─── Company DNA Extension ────────────────────────────────────────────────────
-- Extends product_dna with fields agents need for strategic reasoning.

ALTER TABLE product_dna ADD COLUMN business_model TEXT;
ALTER TABLE product_dna ADD COLUMN revenue_streams TEXT;       -- JSON: string[]
ALTER TABLE product_dna ADD COLUMN target_channels TEXT;       -- JSON: string[]
ALTER TABLE product_dna ADD COLUMN tech_stack TEXT;
ALTER TABLE product_dna ADD COLUMN team_context TEXT;          -- Solo? Small team?
ALTER TABLE product_dna ADD COLUMN competitive_landscape TEXT; -- Narrative summary

-- ─── Agent Instances ─────────────────────────────────────────────────────────
-- One row per agent per company (12 agents × N companies).

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL CHECK(agent_name IN (
    'atlas','compass','prism','beacon','scribe','forge',
    'harbor','sentinel','ledger','shield','oracle','crucible'
  )),
  display_name TEXT NOT NULL,
  role_description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  authority_level INTEGER NOT NULL DEFAULT 2 CHECK(authority_level BETWEEN 0 AND 2),
  -- 0 = fully autonomous
  -- 1 = notify + 24h override window
  -- 2 = require explicit approval before acting
  activation_cadence_hours INTEGER NOT NULL DEFAULT 24,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error')),
  total_sessions INTEGER NOT NULL DEFAULT 0,
  successful_sessions INTEGER NOT NULL DEFAULT 0,
  total_decisions_proposed INTEGER NOT NULL DEFAULT 0,
  total_decisions_approved INTEGER NOT NULL DEFAULT 0,
  total_evolution_cycles INTEGER NOT NULL DEFAULT 0,
  domain_health_score INTEGER DEFAULT 50, -- 0-100, agent's domain health
  -- Agent configuration (versioned via agent_evolution_versions)
  system_prompt_core TEXT,
  behavioral_constraints TEXT,           -- JSON: string[] injected into every prompt
  config_json TEXT,                      -- JSON: full agent config blob
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_product ON agent_instances(product_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(product_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_instances_next_run ON agent_instances(next_run_at, status);

-- ─── Agent Sessions ───────────────────────────────────────────────────────────
-- Each execution of an agent is a session. Full audit trail.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  agent_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'skipped')),
  -- Structured output
  observations TEXT,                -- JSON: string[]
  actions_taken TEXT,               -- JSON: AgentAction[]
  pending_decisions TEXT,           -- JSON: AgentDecision[]
  -- For CEO briefing assembly
  briefing_contribution TEXT,       -- 2-3 sentences for CEO briefing
  briefing_priority TEXT DEFAULT 'normal' CHECK(briefing_priority IN ('high', 'normal', 'low')),
  -- Evolution signals
  evolution_candidates TEXT,        -- JSON: EvolutionCandidate[]
  -- Cost tracking
  tokens_used INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0.0,
  -- Status
  error_message TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_product ON agent_sessions(product_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(product_id, agent_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status, started_at);

-- ─── Agent Evolution Versions ─────────────────────────────────────────────────
-- Immutable history of every change to an agent's configuration.
-- An agent's version number = the highest promoted version here.

CREATE TABLE IF NOT EXISTS agent_evolution_versions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK(change_type IN (
    'golden_lesson', 'constraint_added', 'authority_change',
    'prompt_refinement', 'founder_correction', 'initial_provision'
  )),
  change_description TEXT NOT NULL,    -- Human-readable summary
  trigger_session_id TEXT REFERENCES agent_sessions(id),
  previous_config TEXT,                -- JSON: snapshot of config before change
  new_config TEXT NOT NULL,            -- JSON: snapshot of config after change
  validation_score REAL,               -- 0-1: validation judge score
  validation_notes TEXT,               -- Why the change was accepted/rejected
  promoted_at DATETIME,                -- NULL = pending, non-NULL = live
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, agent_name, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_evo_product ON agent_evolution_versions(product_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_evo_promoted ON agent_evolution_versions(promoted_at);

-- ─── Golden Suite ─────────────────────────────────────────────────────────────
-- Corrections and validations that become behavioral constraints.
-- This is the long-term memory of what works and what doesn't per agent.

CREATE TABLE IF NOT EXISTS golden_suite (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  lesson_type TEXT NOT NULL CHECK(lesson_type IN (
    'correction',        -- Founder changed what the agent proposed
    'validation',        -- Founder confirmed the agent was right
    'behavioral',        -- Observed pattern about how to behave
    'domain'             -- Domain knowledge specific to this company
  )),
  input_context TEXT NOT NULL,         -- What situation prompted this lesson
  expected_behavior TEXT NOT NULL,     -- What the agent should do in this situation
  lesson TEXT NOT NULL,                -- Synthesized lesson (injected into prompts)
  source TEXT NOT NULL CHECK(source IN (
    'founder_correction', 'self_observation', 'evolution_synthesis'
  )),
  confidence REAL DEFAULT 1.0,
  times_reinforced INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,            -- BOOLEAN: FALSE = retired lesson
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_golden_suite_agent ON golden_suite(product_id, agent_name, active);
CREATE INDEX IF NOT EXISTS idx_golden_suite_type ON golden_suite(product_id, lesson_type);

-- ─── CEO Briefings ────────────────────────────────────────────────────────────
-- One briefing per company per day. The founder's primary interface.

CREATE TABLE IF NOT EXISTS scp_briefings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  briefing_date TEXT NOT NULL,         -- YYYY-MM-DD
  signal_score INTEGER,
  risk_state TEXT,
  health_score INTEGER,
  headline TEXT,                       -- One-line summary of the day
  full_briefing TEXT NOT NULL,         -- Complete briefing markdown
  agent_contributions TEXT,            -- JSON: {agent_name: {contribution, priority}}
  pending_decisions TEXT,              -- JSON: AgentDecision[]
  overnight_actions TEXT,              -- JSON: AgentAction[] (already executed)
  experiments_running TEXT,            -- JSON: Experiment[]
  financial_summary TEXT,              -- JSON: {mrr, ai_cost_30d, roi}
  lifecycle_state TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0.0,
  generated_by TEXT DEFAULT 'system',  -- 'system' or 'manual'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_scp_briefings_product ON scp_briefings(product_id, briefing_date DESC);

-- ─── SCP Constitutions ───────────────────────────────────────────────────────
-- Per-company operating constitution: core values, principles, authority framework.

CREATE TABLE IF NOT EXISTS scp_constitutions (
  id TEXT PRIMARY KEY,
  product_id TEXT UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  core_values TEXT,                    -- JSON: string[]
  operating_principles TEXT,           -- JSON: string[]
  authority_framework TEXT,            -- JSON: {agent_name: authority_level}
  evolution_policy TEXT,               -- JSON: evolution configuration
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Agent Cost Attribution ───────────────────────────────────────────────────
-- Tracks token costs and attributed revenue per agent per day.

CREATE TABLE IF NOT EXISTS agent_cost_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  session_id TEXT REFERENCES agent_sessions(id),
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0.0,
  attributed_revenue_usd REAL DEFAULT 0.0, -- Revenue traced to this agent's action
  action_type TEXT,                    -- What kind of action generated this cost
  logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_cost_product ON agent_cost_log(product_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_cost_agent ON agent_cost_log(product_id, agent_name);
