-- onboarding_sessions: tracks chat-based setup progress
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  founder_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','skipped')),
  messages_json TEXT NOT NULL DEFAULT '[]', -- chat history
  extracted_context_json TEXT NOT NULL DEFAULT '{}',
  -- { company_name, problem, solution, target_customer, revenue_model,
  --   current_mrr_estimate, team_size, biggest_challenge, stage }
  dna_fields_populated TEXT NOT NULL DEFAULT '[]', -- which DNA fields were set
  first_briefing_generated INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_product ON onboarding_sessions(product_id);
