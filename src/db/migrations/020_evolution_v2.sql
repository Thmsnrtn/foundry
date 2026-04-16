-- =============================================================================
-- FOUNDRY — Migration 020: SCP Evolution Engine v2
-- Per-agent typed config sections, immutable history, and initiative queue.
-- =============================================================================

-- Per-agent typed config sections (replaces flat behavioral_constraints)
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  config_type TEXT NOT NULL CHECK(config_type IN (
    'persona', 'domain_knowledge', 'task_patterns',
    'tool_preferences', 'error_recovery', 'shared_knowledge'
  )),
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  parent_version INTEGER,
  line_count INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT DEFAULT 'system',
  UNIQUE(product_id, agent_name, config_type)
);

-- Immutable history of each config change
CREATE TABLE IF NOT EXISTS agent_config_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  config_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  changed_by TEXT DEFAULT 'evolution_engine',
  rationale TEXT,
  session_id TEXT,
  gate_scores TEXT  -- JSON: {constitution, regression, size, drift, safety}
);

-- Agent initiative queue (for proactive non-scheduled actions)
CREATE TABLE IF NOT EXISTS agent_initiative_queue (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  initiative_type TEXT NOT NULL,  -- 'proactive_check', 'message_response', 'event_reaction'
  description TEXT NOT NULL,
  context TEXT DEFAULT '{}',
  priority INTEGER DEFAULT 5,    -- 1=critical, 10=low
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_product ON agent_configs(product_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_config_history_agent ON agent_config_history(product_id, agent_name, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_initiative_queue_pending ON agent_initiative_queue(product_id, agent_name, status, priority);
