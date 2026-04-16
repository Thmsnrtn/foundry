-- =============================================================================
-- FOUNDRY — Migration 044: Agent Debate & Synthesis Network
-- Tables for multi-agent debate sessions, positions, challenges, and synthesis.
-- =============================================================================

CREATE TABLE IF NOT EXISTS debate_sessions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  briefing_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | complete
  positions_json TEXT, -- JSON array of agent positions collected
  conflicts_json TEXT, -- JSON array of identified conflicts
  synthesis_json TEXT, -- final synthesized output
  confidence_weights_json TEXT, -- JSON obj: agentName -> weighted_score
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_debate_sessions_product ON debate_sessions(product_id, briefing_date);

CREATE TABLE IF NOT EXISTS agent_positions (
  id TEXT PRIMARY KEY,
  debate_session_id TEXT NOT NULL REFERENCES debate_sessions(id),
  agent_name TEXT NOT NULL,
  position_type TEXT NOT NULL, -- 'assertion' | 'recommendation' | 'risk_flag'
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  accuracy_weight REAL NOT NULL DEFAULT 1.0, -- populated from agent_accuracy_scores
  challenged_by TEXT, -- agent_name that challenged this
  challenge_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_positions_debate ON agent_positions(debate_session_id, agent_name);
