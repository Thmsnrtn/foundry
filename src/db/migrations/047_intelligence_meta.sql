-- Migration 047: Prompt Evolution + Founder Communication Preferences
-- Prompt Evolution: tracks which prompt variations lead to better predictions
CREATE TABLE IF NOT EXISTS evolved_prompts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  prompt_version INTEGER NOT NULL DEFAULT 1,
  mutation_type TEXT NOT NULL, -- 'emphasis_shift' | 'context_addition' | 'framing_change'
  base_prompt_hash TEXT NOT NULL, -- hash of the original system prompt
  delta_instructions TEXT NOT NULL, -- additional instructions to append to base prompt
  reasoning TEXT NOT NULL, -- why this mutation was made
  predictions_before INTEGER NOT NULL DEFAULT 0,
  accuracy_before REAL,
  predictions_after INTEGER NOT NULL DEFAULT 0,
  accuracy_after REAL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_evolved_prompts_active ON evolved_prompts(product_id, agent_name) WHERE is_active = 1;

-- Founder Communication Preferences: learned from override patterns
CREATE TABLE IF NOT EXISTS founder_preferences (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  preference_type TEXT NOT NULL, -- 'detail_level' | 'framing' | 'agent_trust' | 'override_pattern'
  preference_key TEXT NOT NULL,
  preference_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5, -- 0-1, increases with repeated signal
  evidence_count INTEGER NOT NULL DEFAULT 1,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_prefs_key ON founder_preferences(product_id, preference_type, preference_key);
