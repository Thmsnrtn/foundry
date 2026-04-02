-- agent_run_details: full transparency record for each agent run
CREATE TABLE IF NOT EXISTS agent_run_details (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_started_at TEXT NOT NULL,
  run_completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),

  -- What the agent saw
  context_summary_json TEXT NOT NULL DEFAULT '{}',
  -- { metrics_snapshot_date, integration_events_count, unread_messages_count,
  --   config_keys_count, stressors_active, customer_count }
  system_prompt_preview TEXT, -- first 500 chars of system prompt
  user_prompt_preview TEXT, -- first 500 chars of user prompt

  -- What the agent decided
  decisions_count INTEGER NOT NULL DEFAULT 0,
  actions_count INTEGER NOT NULL DEFAULT 0,
  hypotheses_count INTEGER NOT NULL DEFAULT 0,
  messages_sent_count INTEGER NOT NULL DEFAULT 0,
  customer_signals_count INTEGER NOT NULL DEFAULT 0,

  -- Cost and performance
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,

  -- Output
  domain_health_score INTEGER,
  headline TEXT, -- agent's one-line summary
  error_message TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_run_details_product ON agent_run_details(product_id, agent_name, created_at);
CREATE INDEX IF NOT EXISTS idx_run_details_session ON agent_run_details(session_id);

-- weekly_compressed_briefs: 15-minute digest format
CREATE TABLE IF NOT EXISTS weekly_compressed_briefs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  week_of TEXT NOT NULL, -- ISO week: '2026-W14'

  -- The compressed content
  health_score INTEGER NOT NULL,
  health_trend TEXT NOT NULL CHECK (health_trend IN ('improving','stable','declining')),
  one_sentence_status TEXT NOT NULL, -- "You're growing 12% MoM but churn is rising — focus on retention this week."
  top_3_this_week TEXT NOT NULL DEFAULT '[]', -- JSON array of 3 actionable items
  metrics_delta_json TEXT NOT NULL DEFAULT '{}', -- { mrr_change_pct, churn_change, activation_change }
  agent_consensus TEXT, -- what most agents agree on
  one_decision_to_make TEXT, -- the single most important decision this week
  estimated_read_minutes REAL NOT NULL DEFAULT 3.0,

  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_weekly_brief_product ON weekly_compressed_briefs(product_id, week_of);
