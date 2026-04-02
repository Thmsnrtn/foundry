-- Shared agent scratchpad: one row per product per day
CREATE TABLE IF NOT EXISTS agent_scratchpad (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  scratchpad_date TEXT NOT NULL DEFAULT (date('now')),
  -- Each agent writes its key finding as it completes (JSON object, agent_name -> finding)
  findings_json TEXT NOT NULL DEFAULT '{}',
  -- Cross-agent synthesis notes
  consensus_points_json TEXT NOT NULL DEFAULT '[]',  -- things multiple agents agree on
  conflict_points_json TEXT NOT NULL DEFAULT '[]',   -- things agents disagree on
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scratchpad_product_date ON agent_scratchpad(product_id, scratchpad_date);

-- Priority queue: the "One Thing" system
CREATE TABLE IF NOT EXISTS priority_actions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  title TEXT NOT NULL,              -- the one sentence action
  description TEXT,                 -- 2-3 sentence context
  urgency_score REAL NOT NULL,      -- 0-10 (higher = more urgent)
  impact_score REAL NOT NULL,       -- 0-10 (higher = more impactful)
  priority_score REAL NOT NULL,     -- urgency * impact
  source TEXT NOT NULL,             -- 'harbor' | 'forge' | 'ledger' | etc | 'execution_playbook' | 'failure_pattern'
  source_id TEXT,                   -- ID of the underlying record
  action_type TEXT NOT NULL,        -- 'outreach' | 'decision' | 'review' | 'execute' | 'defer'
  action_url TEXT,                  -- deep link to the relevant page
  deadline_hours INTEGER,           -- how many hours until this becomes more urgent
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_priority_actions_product ON priority_actions(product_id, priority_score DESC) WHERE is_active = 1;
